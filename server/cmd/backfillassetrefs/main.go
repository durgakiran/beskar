package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/durgakiran/beskar/assetcleanup"
	"github.com/durgakiran/beskar/core"
	"github.com/joho/godotenv"
)

type config struct {
	ReindexAllPublished bool
	BackfillComments    bool
	ClassifyDrafts      bool
	PageID              int64
	DocID               int64
	RestoreAttachmentID string
	RestoreImageID      string
}

func main() {
	_ = godotenv.Load()
	core.InitializeLogger()
	core.InitializeSlogLogger()
	cfg := parseFlags()
	ctx := context.Background()

	pool := core.GetPool()
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		exitf("failed to connect to postgres: %v", err)
	}

	switch {
	case cfg.DocID > 0:
		if err := assetcleanup.ReindexPublishedDoc(ctx, cfg.DocID); err != nil {
			exitf("reindex published doc %d: %v", cfg.DocID, err)
		}
		fmt.Printf("reindexed published doc %d\n", cfg.DocID)
	case cfg.PageID > 0:
		count, err := assetcleanup.ReindexPublishedPage(ctx, cfg.PageID)
		if err != nil {
			exitf("reindex page %d: %v", cfg.PageID, err)
		}
		fmt.Printf("reindexed %d published docs for page %d\n", count, cfg.PageID)
	case cfg.RestoreAttachmentID != "":
		result, err := assetcleanup.RestoreAsset(ctx, "attachment", cfg.RestoreAttachmentID)
		if err != nil {
			exitf("restore attachment %s: %v", cfg.RestoreAttachmentID, err)
		}
		fmt.Printf("restore attachment result: %+v\n", result)
	case cfg.RestoreImageID != "":
		result, err := assetcleanup.RestoreAsset(ctx, "image", cfg.RestoreImageID)
		if err != nil {
			exitf("restore image %s: %v", cfg.RestoreImageID, err)
		}
		fmt.Printf("restore image result: %+v\n", result)
	default:
		runBackfillPhases(ctx, cfg)
	}
}

func parseFlags() config {
	cfg := config{}
	flag.BoolVar(&cfg.ReindexAllPublished, "reindex-all-published", false, "reindex all retained published documents into core.asset_reference")
	flag.BoolVar(&cfg.BackfillComments, "backfill-comments", false, "backfill comment reply attachment references")
	flag.BoolVar(&cfg.ClassifyDrafts, "classify-drafts", false, "mark existing binary drafts as blocked and recompute cleanup eligibility")
	flag.Int64Var(&cfg.PageID, "page-id", 0, "reindex all published docs for one page")
	flag.Int64Var(&cfg.DocID, "doc-id", 0, "reindex one retained published doc by doc_id")
	flag.StringVar(&cfg.RestoreAttachmentID, "restore-attachment-id", "", "restore one logically deleted attachment before purge")
	flag.StringVar(&cfg.RestoreImageID, "restore-image-id", "", "restore one logically deleted image before purge")
	flag.Parse()
	return cfg
}

func runBackfillPhases(ctx context.Context, cfg config) {
	runPublished := cfg.ReindexAllPublished
	runComments := cfg.BackfillComments
	runDrafts := cfg.ClassifyDrafts
	if !runPublished && !runComments && !runDrafts {
		runPublished = true
		runComments = true
		runDrafts = true
	}

	if runPublished {
		result, err := assetcleanup.BackfillAllPublishedDocs(ctx)
		if err != nil {
			exitf("published backfill failed: %v", err)
		}
		fmt.Printf("published backfill: scanned=%d updated=%d failed=%d\n", result.Scanned, result.Updated, result.Failed)
	}
	if runComments {
		result, err := assetcleanup.BackfillCommentReplyReferences(ctx)
		if err != nil {
			exitf("comment backfill failed: %v", err)
		}
		fmt.Printf("comment backfill: replies=%d updated=%d failed=%d\n", result.Replies, result.Updated, result.Failed)
	}
	if runDrafts {
		result, err := assetcleanup.ClassifyDraftCoverage(ctx)
		if err != nil {
			exitf("draft classification failed: %v", err)
		}
		fmt.Printf("draft classification: blocked=%d eligible=%d\n", result.BlockedDraftPages, result.EligiblePages)
	}
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
