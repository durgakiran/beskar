package assetcleanup

import (
	"testing"

	"github.com/durgakiran/beskar/assetref"
	"github.com/durgakiran/beskar/internal/testutil"
	"github.com/google/uuid"
)

func TestPublishedDocumentAssetIndexingPostgres(t *testing.T) {
	ctx, tx, spaceID, _, rootID := testutil.DocumentNodes(t)
	attachmentID, imageID := uuid.New(), uuid.New()
	testutil.Exec(t, ctx, tx, `INSERT INTO core.attachment VALUES($1,1,NULL)`, attachmentID)
	testutil.Exec(t, ctx, tx, `INSERT INTO core.image_asset VALUES($1,'test-image.png',1,NULL)`, imageID)
	testutil.Exec(t, ctx, tx, `INSERT INTO core.content VALUES($1,10,$2,2,'attachmentInline',jsonb_build_object('attachmentId',$3::text),'[]')`, uuid.New(), rootID, attachmentID.String())
	version, err := loadPublishedDocVersion(ctx, tx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if version.DocID != 10 || version.PageID != 1 || version.SpaceID != spaceID || len(version.Nodes.Content) != 3 || len(version.Nodes.Text) != 1 || version.Nodes.Text[0].ParentId != rootID || version.Nodes.Text[0].Text != "Nested text" {
		t.Fatalf("unexpected loaded version: %+v", version)
	}
	// Reindex twice to verify references are replaced rather than duplicated.
	for i := 0; i < 2; i++ {
		if err := reindexPublishedDocTx(ctx, tx, 10); err != nil {
			t.Fatal(err)
		}
		rows, err := tx.Query(ctx, `SELECT asset_type, asset_id, page_id, doc_id, source_kind, source_id FROM core.asset_reference`)
		if err != nil {
			t.Fatal(err)
		}
		found := make(map[string]string)
		count := 0
		for rows.Next() {
			var kind, id, sourceKind, sourceID string
			var pageID, docID int64
			if err := rows.Scan(&kind, &id, &pageID, &docID, &sourceKind, &sourceID); err != nil {
				t.Fatal(err)
			}
			if pageID != 1 || docID != 10 || sourceKind != assetref.SourceKindPublishedDoc || sourceID != "10" {
				t.Fatalf("incorrect reference ownership: page=%d doc=%d source=%s/%s", pageID, docID, sourceKind, sourceID)
			}
			found[kind] = id
			count++
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
		if count != 2 || found[assetref.AssetTypeAttachment] != attachmentID.String() || found[assetref.AssetTypeImage] != imageID.String() {
			t.Fatalf("unexpected indexed references: count=%d refs=%v", count, found)
		}
	}
}
