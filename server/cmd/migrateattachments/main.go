package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/durgakiran/beskar/core"
	blobstorage "github.com/durgakiran/beskar/storage"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

type attachmentRow struct {
	ID          string
	StoragePath string
	MimeType    string
}

type migrateConfig struct {
	DryRun          bool
	Limit           int
	Verbose         bool
	FailFast        bool
	SourceUploadDir string
	LegacyPublicDir string
}

type migrateStats struct {
	Scanned         int
	Uploaded        int
	SkippedExisting int
	UpdatedRows     int
	MissingFiles    int
	NormalizeErrors int
	UploadErrors    int
	DBUpdateErrors  int
}

func main() {
	_ = godotenv.Load()

	cfg := parseFlags()

	ctx := context.Background()
	store, err := blobstorage.RuntimeStore(ctx)
	if err != nil {
		exitf("failed to initialize object storage: %v", err)
	}

	pool := core.GetPool()
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		exitf("failed to connect to postgres: %v", err)
	}

	rows, err := loadAttachmentRows(ctx, pool, cfg.Limit)
	if err != nil {
		exitf("failed to load attachments: %v", err)
	}

	stats := migrateStats{}
	for _, row := range rows {
		stats.Scanned++
		if cfg.Verbose {
			fmt.Printf("attachment %s: storage_path=%q\n", row.ID, row.StoragePath)
		}

		normalizedKey, candidates, err := resolveAttachment(row.StoragePath, cfg.SourceUploadDir, cfg.LegacyPublicDir)
		if err != nil {
			stats.NormalizeErrors++
			printErr("normalize", row.ID, err)
			if cfg.FailFast {
				break
			}
			continue
		}

		sourcePath, err := firstExistingPath(candidates)
		if err != nil {
			stats.MissingFiles++
			printErr("missing", row.ID, fmt.Errorf("%w; tried=%v", err, candidates))
			if cfg.FailFast {
				break
			}
			continue
		}

		exists, err := store.Exists(ctx, normalizedKey)
		if err != nil {
			stats.UploadErrors++
			printErr("exists", row.ID, err)
			if cfg.FailFast {
				break
			}
			continue
		}

		if exists {
			stats.SkippedExisting++
			if cfg.Verbose {
				fmt.Printf("attachment %s: object already exists at %s\n", row.ID, normalizedKey)
			}
		} else if cfg.DryRun {
			fmt.Printf("[dry-run] attachment %s: upload %s -> %s\n", row.ID, sourcePath, normalizedKey)
		} else {
			if err := uploadFile(ctx, store, sourcePath, normalizedKey, row.MimeType); err != nil {
				stats.UploadErrors++
				printErr("upload", row.ID, err)
				if cfg.FailFast {
					break
				}
				continue
			}
			stats.Uploaded++
			fmt.Printf("attachment %s: uploaded %s -> %s\n", row.ID, sourcePath, normalizedKey)
		}

		if row.StoragePath == normalizedKey {
			continue
		}

		if cfg.DryRun {
			fmt.Printf("[dry-run] attachment %s: update storage_path %q -> %q\n", row.ID, row.StoragePath, normalizedKey)
			continue
		}

		if err := updateAttachmentStoragePath(ctx, pool, row.ID, normalizedKey); err != nil {
			stats.DBUpdateErrors++
			printErr("db-update", row.ID, err)
			if cfg.FailFast {
				break
			}
			continue
		}

		stats.UpdatedRows++
		fmt.Printf("attachment %s: updated storage_path -> %s\n", row.ID, normalizedKey)
	}

	printSummary(cfg, stats)
}

func parseFlags() migrateConfig {
	defaultUploadDir := strings.TrimSpace(os.Getenv("UPLOAD_STORAGE_DIR"))
	if defaultUploadDir == "" {
		defaultUploadDir = "public"
	}

	cfg := migrateConfig{}
	flag.BoolVar(&cfg.DryRun, "dry-run", true, "preview uploads and DB updates without changing S3 or Postgres")
	flag.IntVar(&cfg.Limit, "limit", 0, "max number of attachment rows to process; 0 means all")
	flag.BoolVar(&cfg.Verbose, "verbose", false, "print per-row resolution details")
	flag.BoolVar(&cfg.FailFast, "fail-fast", false, "stop on the first migration error")
	flag.StringVar(&cfg.SourceUploadDir, "source-upload-dir", defaultUploadDir, "local upload root that contains attachments/ (defaults to UPLOAD_STORAGE_DIR or public)")
	flag.StringVar(&cfg.LegacyPublicDir, "legacy-public-dir", "public", "legacy public root that may also contain attachments/")
	flag.Parse()

	cfg.SourceUploadDir = filepath.Clean(strings.TrimSpace(cfg.SourceUploadDir))
	cfg.LegacyPublicDir = filepath.Clean(strings.TrimSpace(cfg.LegacyPublicDir))
	return cfg
}

func loadAttachmentRows(ctx context.Context, pool *pgxpool.Pool, limit int) ([]attachmentRow, error) {
	query := `SELECT id::text, storage_path, mime_type
FROM core.attachment
WHERE deleted_at IS NULL
ORDER BY created_at ASC, id ASC`
	args := []any{}
	if limit > 0 {
		query += "\nLIMIT $1"
		args = append(args, limit)
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (attachmentRow, error) {
		var rec attachmentRow
		err := row.Scan(&rec.ID, &rec.StoragePath, &rec.MimeType)
		return rec, err
	})
}

func resolveAttachment(storagePath, sourceUploadDir, legacyPublicDir string) (string, []string, error) {
	cleaned, err := cleanStoragePath(storagePath)
	if err != nil {
		return "", nil, err
	}

	uploadRoot := cleanSlashPath(sourceUploadDir)
	legacyRoot := cleanSlashPath(legacyPublicDir)

	key := ""
	switch {
	case strings.HasPrefix(cleaned, "attachments/"):
		key = cleaned
	case uploadRoot != "" && uploadRoot != "." && strings.HasPrefix(cleaned, uploadRoot+"/attachments/"):
		key = strings.TrimPrefix(cleaned, uploadRoot+"/")
	case legacyRoot != "" && legacyRoot != "." && strings.HasPrefix(cleaned, legacyRoot+"/attachments/"):
		key = strings.TrimPrefix(cleaned, legacyRoot+"/")
	default:
		if idx := strings.Index(cleaned, "/attachments/"); idx >= 0 {
			key = strings.TrimPrefix(cleaned[idx+1:], "/")
		} else if strings.HasPrefix(cleaned, "/attachments/") {
			key = strings.TrimPrefix(cleaned, "/")
		}
	}

	if key == "" || !strings.HasPrefix(key, "attachments/") {
		return "", nil, fmt.Errorf("cannot normalize attachment path %q", storagePath)
	}

	candidates := make([]string, 0, 3)
	appendCandidate := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return
		}
		candidate = filepath.Clean(candidate)
		for _, existing := range candidates {
			if existing == candidate {
				return
			}
		}
		candidates = append(candidates, candidate)
	}

	originalPath := filepath.Clean(filepath.FromSlash(cleaned))
	if cleaned != key {
		appendCandidate(originalPath)
	}
	appendCandidate(filepath.Join(sourceUploadDir, filepath.FromSlash(key)))
	appendCandidate(filepath.Join(legacyPublicDir, filepath.FromSlash(key)))

	return key, candidates, nil
}

func cleanStoragePath(storagePath string) (string, error) {
	norm := strings.ReplaceAll(strings.TrimSpace(storagePath), "\\", "/")
	if norm == "" {
		return "", errors.New("storage path is empty")
	}

	cleaned := path.Clean(norm)
	switch {
	case cleaned == ".", cleaned == "..", strings.HasPrefix(cleaned, "../"), strings.Contains(cleaned, "/../"):
		return "", errors.New("storage path is invalid")
	default:
		return cleaned, nil
	}
}

func cleanSlashPath(dir string) string {
	trimmed := strings.TrimSpace(dir)
	if trimmed == "" {
		return ""
	}
	return path.Clean(strings.ReplaceAll(trimmed, "\\", "/"))
}

func firstExistingPath(candidates []string) (string, error) {
	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if err == nil && info.Mode().IsRegular() {
			return candidate, nil
		}
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
	}
	return "", fs.ErrNotExist
}

func uploadFile(ctx context.Context, store blobstorage.Store, sourcePath, objectKey, contentType string) error {
	file, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return err
	}

	if contentType == "" {
		contentType = "application/octet-stream"
	}

	head := make([]byte, 512)
	n, readErr := file.Read(head)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		return readErr
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if contentType == "application/octet-stream" && n > 0 {
		contentType = http.DetectContentType(head[:n])
	}

	return store.Put(ctx, objectKey, file, info.Size(), contentType)
}

func updateAttachmentStoragePath(ctx context.Context, pool *pgxpool.Pool, id, normalizedKey string) error {
	const q = `UPDATE core.attachment
SET storage_path = $2
WHERE id = $1::uuid`
	_, err := pool.Exec(ctx, q, id, normalizedKey)
	return err
}

func printErr(stage, id string, err error) {
	fmt.Fprintf(os.Stderr, "attachment %s: %s error: %v\n", id, stage, err)
}

func printSummary(cfg migrateConfig, stats migrateStats) {
	mode := "apply"
	if cfg.DryRun {
		mode = "dry-run"
	}
	fmt.Printf("\nAttachment migration summary (%s)\n", mode)
	fmt.Printf("  scanned: %d\n", stats.Scanned)
	fmt.Printf("  uploaded: %d\n", stats.Uploaded)
	fmt.Printf("  skipped-existing: %d\n", stats.SkippedExisting)
	fmt.Printf("  db-updated: %d\n", stats.UpdatedRows)
	fmt.Printf("  missing-files: %d\n", stats.MissingFiles)
	fmt.Printf("  normalize-errors: %d\n", stats.NormalizeErrors)
	fmt.Printf("  upload-errors: %d\n", stats.UploadErrors)
	fmt.Printf("  db-update-errors: %d\n", stats.DBUpdateErrors)
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
