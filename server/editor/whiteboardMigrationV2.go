package editor

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	errWhiteboardMigrationAssets = errors.New("This whiteboard contains an unsupported legacy asset format.")
	errWhiteboardMigrationFormat = errors.New("This whiteboard format cannot be safely migrated.")
	errWhiteboardMigrationSource = errors.New("The legacy whiteboard changed. Load its latest state and prepare migration again.")
	errWhiteboardMigrated        = errors.New("This whiteboard has migrated to v2. Reload the page; pending local recovery is retained.")
)

type whiteboardMigrationSource struct {
	ContentAPIVersion int    `json:"contentApiVersion"`
	SourceDocID       int64  `json:"sourceDocId,string"`
	State             []byte `json:"state,omitempty"`
	Title             string `json:"title,omitempty"`
	UpdateEncoding    string `json:"updateEncoding,omitempty"`
	StateDigest       string `json:"stateDigest,omitempty"`
	Fingerprint       string `json:"sourceFingerprint,omitempty"`
	inspection        whiteboardMigrationInspection
}
type whiteboardMigrationBody struct {
	SourceDocID       int64  `json:"sourceDocId,string"`
	SourceFingerprint string `json:"sourceFingerprint"`
	State             []byte `json:"state"`
	Title             string `json:"title"`
	UpdateEncoding    string `json:"updateEncoding"`
	Preview           struct {
		ContentType string `json:"contentType"`
		Data        []byte `json:"data"`
	} `json:"preview"`
}
type whiteboardMigrationInput struct {
	whiteboardDraftInput
	whiteboardMigrationBody
	IdempotencyKey uuid.UUID
}
type whiteboardMigrationResult struct {
	PageID            int64     `json:"pageId"`
	ContentAPIVersion int       `json:"contentApiVersion"`
	SnapshotID        uuid.UUID `json:"snapshotId"`
	VersionID         uuid.UUID `json:"versionId"`
	Sequence          int64     `json:"sequence,string"`
}

const migrationSourceSQL = `SELECT d.doc_id, d.title, d.draft, d.version,
 COALESCE(octet_length(wd.data),0), CASE WHEN octet_length(wd.data)<=$3 THEN wd.data ELSE NULL END,
 COALESCE(wd.revision,0), COALESCE(wd.server_update_sequence,0)
 FROM core.page p JOIN core.space s ON s.id=p.space_id
 JOIN core.page_doc_map d ON d.page_id=p.id
 LEFT JOIN core.whiteboard_data wd ON wd.doc_id=d.doc_id
 WHERE p.id=$1 AND p.space_id=$2 AND s.deleted_at IS NULL
 AND (p.type='whiteboard' OR EXISTS(SELECT 1 FROM core.whiteboard_data x JOIN core.page_doc_map m ON m.doc_id=x.doc_id WHERE m.page_id=p.id))
 AND d.draft IN (0,1) ORDER BY d.draft DESC, d.version DESC, d.doc_id DESC LIMIT 1`
const migrationPageLockSQL = `SELECT owner_id,date_created FROM core.page WHERE id=$1 AND space_id=$2 FOR UPDATE`
const migrationExistsSQL = `SELECT EXISTS(SELECT 1 FROM whiteboard.whiteboard w JOIN core.page p ON p.id=w.page_id JOIN core.space s ON s.id=p.space_id WHERE w.page_id=$1 AND p.space_id=$2 AND s.deleted_at IS NULL)`
const migrationReceiptSQL = `SELECT actor_id,idempotency_key,request_hash,snapshot_id,version_id FROM whiteboard.whiteboard_migration_receipt WHERE page_id=$1`
const migrationInsertReceiptSQL = `INSERT INTO whiteboard.whiteboard_migration_receipt(page_id,actor_id,idempotency_key,request_hash,source_doc_id,source_fingerprint,snapshot_id,version_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`

func migrationDigest(data []byte) string { return fmt.Sprintf("sha256:%x", sha256.Sum256(data)) }

func readMigrationSource(ctx context.Context, tx pgx.Tx, in whiteboardDraftInput) (whiteboardMigrationSource, error) {
	out := whiteboardMigrationSource{ContentAPIVersion: 1, UpdateEncoding: whiteboardUpdateEncodingV1}
	var draft, size int
	var revision, sequence int64
	var version time.Time
	err := tx.QueryRow(ctx, migrationSourceSQL, in.PageID, in.SpaceID, whiteboardPublishMaxBytes).Scan(&out.SourceDocID, &out.Title, &draft, &version, &size, &out.State, &revision, &sequence)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return out, err
	}
	if size > whiteboardPublishMaxBytes {
		return out, errWhiteboardPublishLimit
	}
	// Missing/empty legacy payloads represent an unsaved empty board.
	rawDigest := migrationDigest(out.State)
	if len(out.State) == 0 {
		out.State = []byte{0, 0}
	}
	out.StateDigest = migrationDigest(out.State)
	fingerprint, _ := json.Marshal([]any{out.SourceDocID, out.Title, draft, version, rawDigest, revision, sequence})
	out.Fingerprint = migrationDigest(fingerprint)
	return out, nil
}

func (s *whiteboardServiceV2) inspectMigrationState(ctx context.Context, state []byte, identity string) (whiteboardMigrationInspection, error) {
	if s.inspectMigration != nil {
		return s.inspectMigration(ctx, state, identity)
	}
	return inspectWhiteboardMigration(ctx, state, identity)
}

func (s *whiteboardServiceV2) GetMigrationSource(ctx context.Context, in whiteboardDraftInput) (whiteboardMigrationSource, error) {
	tx, err := s.begin(ctx)
	if err != nil {
		return whiteboardMigrationSource{}, err
	}
	defer draftRollback(ctx, tx)
	var exists bool
	if err = tx.QueryRow(ctx, migrationExistsSQL, in.PageID, in.SpaceID).Scan(&exists); err != nil {
		return whiteboardMigrationSource{}, err
	}
	if exists {
		return whiteboardMigrationSource{ContentAPIVersion: 2}, nil
	}
	source, err := readMigrationSource(ctx, tx, in)
	// Release the database connection before invoking the bounded Yjs process.
	draftRollback(ctx, tx)
	if err != nil {
		return source, err
	}
	if source.inspection, err = s.inspectMigrationState(ctx, source.State, ""); err != nil {
		return source, err
	}
	return source, nil
}

func (s *whiteboardServiceV2) MigrateWhiteboard(ctx context.Context, in whiteboardMigrationInput) (whiteboardMigrationResult, error) {
	out := whiteboardMigrationResult{PageID: in.PageID, ContentAPIVersion: 2}
	normalized, err := normalizeWhiteboardTitle(in.Title)
	if err != nil || normalized == nil || *normalized != in.Title {
		return out, errWhiteboardMigrationFormat
	}
	if in.SourceDocID <= 0 || len(in.SourceFingerprint) != 71 || in.UpdateEncoding != whiteboardUpdateEncodingV1 || len(in.State) == 0 || in.Preview.ContentType != "image/png" {
		return out, errWhiteboardMigrationFormat
	}
	if len(in.State) > whiteboardPublishMaxBytes {
		return out, errWhiteboardPublishLimit
	}
	if validateYjsUpdateV1(in.State) != nil {
		return out, errWhiteboardMigrationFormat
	}
	preview, err := validateWhiteboardPreview(in.Preview.Data)
	if err != nil {
		return out, err
	}
	submitted, err := s.inspectMigrationState(ctx, in.State, fmt.Sprintf("v2:%s:%d", in.SpaceID, in.PageID))
	if err != nil {
		return out, err
	}
	requestBytes, _ := json.Marshal(in.whiteboardMigrationBody)
	requestHash := migrationDigest(requestBytes)

	// Inspect the original independently; clients cannot strip, add, or mutate
	// asset records in the submitted snapshot to change the migration manifest.
	source, err := s.GetMigrationSource(ctx, in.whiteboardDraftInput)
	if err != nil {
		return out, err
	}
	if source.ContentAPIVersion == 1 && (source.SourceDocID != in.SourceDocID || source.Fingerprint != in.SourceFingerprint) {
		return out, errWhiteboardMigrationSource
	}
	// Receipt lookup precedes copying. Replaying a completed migration must not
	// allocate another set of objects or charge retained legacy bytes again.
	if receipt, found, receiptErr := s.migrationReceipt(ctx, in, requestHash); receiptErr != nil || found {
		return receipt, receiptErr
	}
	if source.ContentAPIVersion != 1 {
		return out, errWhiteboardMigrated
	}
	if err = validateMigrationAssetManifests(source.inspection, submitted); err != nil {
		return out, err
	}
	ctx, cancel := context.WithTimeout(ctx, whiteboardMigrationAssetCopyTimeout)
	defer cancel()
	copies, err := s.copyMigrationAssets(ctx, in, submitted.Assets)
	if errors.Is(err, errWhiteboardMigrated) {
		if receipt, found, receiptErr := s.migrationReceipt(ctx, in, requestHash); receiptErr != nil || found {
			return receipt, receiptErr
		}
	}
	if err != nil {
		return out, err
	}

	tx, err := s.begin(ctx)
	if err != nil {
		return out, err
	}
	defer draftRollback(ctx, tx)
	if _, err = tx.Exec(ctx, whiteboardV2SetLockTimeout); err != nil {
		return out, err
	}
	var archived, deleted bool
	if err = tx.QueryRow(ctx, whiteboardV2LockSpace, in.SpaceID).Scan(&archived, &deleted); errors.Is(err, pgx.ErrNoRows) || deleted {
		return out, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return out, err
	}
	var owner uuid.UUID
	var created time.Time
	if err = tx.QueryRow(ctx, migrationPageLockSQL, in.PageID, in.SpaceID).Scan(&owner, &created); errors.Is(err, pgx.ErrNoRows) {
		return out, errWhiteboardV2BoardNotFound
	}
	if err != nil {
		return out, err
	}
	var actor, key uuid.UUID
	var hash string
	err = tx.QueryRow(ctx, migrationReceiptSQL, in.PageID).Scan(&actor, &key, &hash, &out.SnapshotID, &out.VersionID)
	if err == nil {
		if actor == in.ActorID && key == in.IdempotencyKey && hash != requestHash {
			return out, errWhiteboardV2KeyReuse
		}
		return out, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return out, err
	}
	var exists bool
	if err = tx.QueryRow(ctx, migrationExistsSQL, in.PageID, in.SpaceID).Scan(&exists); err != nil {
		return out, err
	}
	if exists {
		return out, errWhiteboardMigrated
	}
	if archived {
		return out, errWhiteboardV2Archived
	}
	current, err := readMigrationSource(ctx, tx, in.whiteboardDraftInput)
	if err != nil {
		return out, err
	}
	if current.SourceDocID != in.SourceDocID || current.Fingerprint != in.SourceFingerprint || source.ContentAPIVersion != 1 {
		return out, errWhiteboardMigrationSource
	}
	// Fingerprint equality binds the locked source to the exact bytes inspected.
	title, err := normalizeWhiteboardTitle(current.Title)
	if err != nil || title == nil || *title != in.Title {
		return out, errWhiteboardMigrationFormat
	}
	if err = lockMigrationAssetCopies(ctx, tx, in, copies); err != nil {
		return out, err
	}
	out.SnapshotID = uuid.New()
	out.VersionID = uuid.New()
	writes := []struct {
		query string
		args  []any
	}{
		// Older boards can still carry the original default document type.
		// Correct it so document-history cleanup cannot prune retained v1 history.
		{`UPDATE core.page SET type='whiteboard' WHERE id=$1`, []any{in.PageID}},
		{`INSERT INTO whiteboard.whiteboard(page_id,created_by,created_at) VALUES($1,$2,$3)`, []any{in.PageID, owner, created}},
		{whiteboardV2InsertSnapshot, []any{out.SnapshotID, in.PageID, in.State, migrationDigest(in.State), in.Title, in.ActorID}},
		{whiteboardV2InsertDraft, []any{in.PageID, out.SnapshotID, in.ActorID}},
		{whiteboardV2PublishVersion, []any{out.VersionID, in.PageID, out.SnapshotID, in.ActorID, in.IdempotencyKey}},
		{whiteboardV2InsertPreview, []any{out.VersionID, preview.Bytes, preview.Digest, preview.Width, preview.Height}},
		{whiteboardV2PublishPointer, []any{in.PageID, out.VersionID}},
		{migrationInsertReceiptSQL, []any{in.PageID, in.ActorID, in.IdempotencyKey, requestHash, in.SourceDocID, in.SourceFingerprint, out.SnapshotID, out.VersionID}},
	}
	for _, w := range writes {
		if _, err = tx.Exec(ctx, w.query, w.args...); err != nil {
			return out, err
		}
		if w.query == whiteboardV2InsertSnapshot {
			if err = insertMigrationAssets(ctx, tx, in, copies); err != nil {
				return out, err
			}
			if err = associateWhiteboardSnapshotAssets(ctx, tx, in.PageID, out.SnapshotID, migrationDigest(in.State), migrationAssetManifest(submitted)); err != nil {
				return out, err
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return out, err
	}
	return out, nil
}

func (s *whiteboardServiceV2) migrationReceipt(ctx context.Context, in whiteboardMigrationInput, requestHash string) (whiteboardMigrationResult, bool, error) {
	out := whiteboardMigrationResult{PageID: in.PageID, ContentAPIVersion: 2}
	tx, err := s.begin(ctx)
	if err != nil {
		return out, false, err
	}
	defer draftRollback(ctx, tx)
	var actor, key uuid.UUID
	var hash string
	err = tx.QueryRow(ctx, `SELECT r.actor_id,r.idempotency_key,r.request_hash,r.snapshot_id,r.version_id
	 FROM whiteboard.whiteboard_migration_receipt r JOIN core.page p ON p.id=r.page_id JOIN core.space s ON s.id=p.space_id
	 WHERE r.page_id=$1 AND p.space_id=$2 AND s.deleted_at IS NULL`, in.PageID, in.SpaceID).Scan(&actor, &key, &hash, &out.SnapshotID, &out.VersionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, false, nil
	}
	if err != nil {
		return out, false, err
	}
	if actor == in.ActorID && key == in.IdempotencyKey && hash != requestHash {
		return out, true, errWhiteboardV2KeyReuse
	}
	return out, true, nil
}

// Every legacy content writer takes the same page lock before reading or
// mutating source rows. Migration can then inspect/recheck without racing saves.
func lockLegacyWhiteboardPage(ctx context.Context, tx pgx.Tx, pageID int64) error {
	var space uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT space_id FROM core.page WHERE id=$1`, pageID).Scan(&space); err != nil {
		return err
	}
	var archived, deleted bool
	if err := tx.QueryRow(ctx, whiteboardV2LockSpace, space).Scan(&archived, &deleted); err != nil {
		return err
	}
	var id int64
	if err := tx.QueryRow(ctx, `SELECT id FROM core.page WHERE id=$1 AND space_id=$2 FOR UPDATE`, pageID, space).Scan(&id); err != nil {
		return err
	}
	var migrated bool
	if err := tx.QueryRow(ctx, migrationExistsSQL, pageID, space).Scan(&migrated); err != nil {
		return err
	}
	if migrated {
		return errWhiteboardMigrated
	}
	return nil
}
