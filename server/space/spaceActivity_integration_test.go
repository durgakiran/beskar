package space

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSpaceListActivityPostgres(t *testing.T) {
	dsn := os.Getenv("SPACE_ACTIVITY_TEST_DSN")
	if dsn == "" {
		t.Skip("set SPACE_ACTIVITY_TEST_DSN to a disposable space_activity_test database")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Database != "space_activity_test" {
		t.Fatal("requires disposable space_activity_test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE SCHEMA core; CREATE SCHEMA whiteboard;
		CREATE TABLE core.space (id uuid PRIMARY KEY, name text, description text, user_id uuid,
			date_created timestamptz, date_updated timestamptz, archived_at timestamptz, deleted_at timestamptz);
		CREATE TABLE core.page (id bigint PRIMARY KEY, space_id uuid, type text, date_created timestamptz);
		CREATE TABLE core.page_doc_map (doc_id bigint PRIMARY KEY, page_id bigint, version timestamptz, draft smallint);
		CREATE TABLE core.whiteboard_data (doc_id bigint PRIMARY KEY, updated_at timestamp);
		CREATE TABLE whiteboard.whiteboard_draft (page_id bigint PRIMARY KEY, updated_at timestamptz);
		CREATE TABLE whiteboard.whiteboard (page_id bigint PRIMARY KEY, published_version_id uuid);
		CREATE TABLE whiteboard.whiteboard_version (id uuid PRIMARY KEY, page_id bigint, published_at timestamptz);
		SET LOCAL TIME ZONE 'UTC';`)

	spaceID, emptyID, excludedID, deletedID, owner := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	now := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	at := func(hours int) time.Time { return now.Add(time.Duration(hours) * time.Hour) }
	for _, id := range []uuid.UUID{spaceID, emptyID, excludedID, deletedID} {
		exec(`INSERT INTO core.space (id,name,description,user_id,date_created,date_updated)
			VALUES ($1,'Space','Description',$2,$3,$3)`, id, owner, at(0))
	}
	exec(`UPDATE core.space SET date_updated=$2 WHERE id=$1`, emptyID, at(1))
	exec(`UPDATE core.space SET deleted_at=$2 WHERE id=$1`, deletedID, at(1))
	exec(`INSERT INTO core.page VALUES (100,$1,'document',$2)`, excludedID, at(100))

	metadataUpdated := at(0)
	check := func(label string, latest time.Time, docs, boards int, firstID uuid.UUID) {
		t.Helper()
		rows, err := tx.Query(ctx, GET_SPACES, []uuid.UUID{spaceID, emptyID, deletedID})
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var items []SpaceListItem
		for rows.Next() {
			var item SpaceListItem
			if err := rows.Scan(&item.Id, &item.Name, &item.Description, &item.DateUpdated, &item.LastActivityAt, &item.CreatedBy,
				&item.ArchivedAt, &item.DocCount, &item.WhiteboardCount); err != nil {
				t.Fatal(err)
			}
			items = append(items, item)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		if len(items) != 2 || items[0].Id != firstID {
			t.Fatalf("%s: unexpected space list %+v", label, items)
		}
		for _, item := range items {
			switch item.Id {
			case spaceID:
				if !item.DateUpdated.Equal(metadataUpdated) {
					t.Fatalf("%s: space metadata timestamp changed: %s", label, item.DateUpdated)
				}
				if !item.LastActivityAt.Equal(latest) || item.DocCount != docs || item.WhiteboardCount != boards {
					t.Fatalf("%s: activity %s and counts %d/%d, want %s and %d/%d", label,
						item.LastActivityAt, item.DocCount, item.WhiteboardCount, latest, docs, boards)
				}
			case emptyID:
				if !item.LastActivityAt.Equal(at(1)) || item.DocCount != 0 || item.WhiteboardCount != 0 {
					t.Fatalf("%s: empty space changed: %+v", label, item)
				}
			default:
				t.Fatalf("%s: unexpected space %s", label, item.Id)
			}
		}
	}

	check("empty space uses its metadata timestamp", at(0), 0, 0, emptyID)
	exec(`INSERT INTO core.page VALUES (1,$1,NULL,$2)`, spaceID, at(2))
	check("page created", at(2), 1, 0, spaceID)
	exec(`INSERT INTO core.page_doc_map VALUES (1,1,$1,0), (2,1,$2,1)`, at(2), at(3))
	check("document edited", at(3), 1, 0, spaceID)
	exec(`UPDATE core.page_doc_map SET version=$1,draft=0 WHERE doc_id=2`, at(4))
	check("document published", at(4), 1, 0, spaceID)
	exec(`INSERT INTO core.page VALUES (2,$1,'whiteboard',$2)`, spaceID, at(5))
	check("whiteboard created", at(5), 1, 1, spaceID)
	exec(`INSERT INTO whiteboard.whiteboard_draft VALUES (2,$1)`, at(6))
	check("whiteboard edited", at(6), 1, 1, spaceID)
	versionID := uuid.New()
	exec(`INSERT INTO whiteboard.whiteboard VALUES (2,$1)`, versionID)
	exec(`INSERT INTO whiteboard.whiteboard_version VALUES ($1,2,$2)`, versionID, at(7))
	check("whiteboard published", at(7), 1, 1, spaceID)
	exec(`INSERT INTO core.page VALUES (3,$1,'whiteboard',$2)`, spaceID, at(2))
	exec(`INSERT INTO core.page_doc_map VALUES (3,3,$1,1)`, at(2))
	exec(`INSERT INTO core.whiteboard_data VALUES (3,$1::timestamptz::timestamp)`, at(8))
	check("legacy whiteboard edited", at(8), 1, 2, spaceID)
	metadataUpdated = at(9)
	exec(UPDATE_SPACE, "New space title", "New description", metadataUpdated, spaceID)
	check("space metadata edited", metadataUpdated, 1, 2, spaceID)
}
