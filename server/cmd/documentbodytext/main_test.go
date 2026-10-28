package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validPublication = `{"spaceId":"00000000-0000-0000-0000-000000000090","createdBy":"00000000-0000-0000-0000-000000000091","pageId":12,"docId":7,"title":"Title","createdAt":"2026-10-01T00:00:00Z","updatedAt":"2026-10-02T00:00:00Z","content":[{"contentId":"00000000-0000-0000-0000-000000000001","parentId":"00000000-0000-0000-0000-000000000000","docId":7,"orderId":0,"type":"doc"},{"contentId":"00000000-0000-0000-0000-000000000002","parentId":"00000000-0000-0000-0000-000000000001","docId":7,"orderId":0,"type":"paragraph"}],"text":[{"parentId":"00000000-0000-0000-0000-000000000002","docId":7,"orderId":0,"text":"Hello database"}]}`

func TestRunWritesPrivateDocumentsAndRefusesOverwrite(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.jsonl")
	output := filepath.Join(dir, "output.jsonl")
	if err := os.WriteFile(input, []byte(validPublication+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	args := []string{"--input", input, "--output", output}
	if err := run(args, &stdout, &stderr); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc) != 8 || doc["bodyText"] != "Hello database" {
		t.Fatalf("unexpected output %s", data)
	}
	info, _ := os.Stat(output)
	if info.Mode().Perm() != 0600 {
		t.Fatal("output is not private")
	}
	if stdout.Len() != 0 || !strings.Contains(stderr.String(), "Generated 1 documents; 0 failed") {
		t.Fatal("unexpected diagnostics")
	}
	if err := run(args, &stdout, &stderr); err == nil {
		t.Fatal("overwrote existing file")
	}
	after, _ := os.ReadFile(output)
	if !bytes.Equal(data, after) {
		t.Fatal("existing output modified")
	}
}

func TestRunReportsPartialGeneration(t *testing.T) {
	input := filepath.Join(t.TempDir(), "input.jsonl")
	bad := `{"pageId":13,"docId":8,"spaceId":"00000000-0000-0000-0000-000000000090","createdBy":"00000000-0000-0000-0000-000000000091","createdAt":"2026-10-01T00:00:00Z","updatedAt":"2026-10-02T00:00:00Z","content":[],"text":[{"parentId":"00000000-0000-0000-0000-000000000099","docId":8,"orderId":0,"text":"Orphan text must not be silently emptied"}]}`
	os.WriteFile(input, []byte(bad+"\n"+validPublication+"\n"), 0600)
	var stdout, stderr bytes.Buffer
	err := run([]string{"--input", input}, &stdout, &stderr)
	if err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("err=%v", err)
	}
	if !strings.Contains(stderr.String(), "page=13 doc=8") || !strings.Contains(stderr.String(), "1 failed") {
		t.Fatal("missing failure diagnostics")
	}
	var doc map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if doc["pageId"] != float64(12) {
		t.Fatal("failed record emitted")
	}
}

func TestRunExportAndValidation(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if err := run([]string{"--export-sql", "--page-id", "139"}, &stdout, &stderr); err != nil {
		t.Fatal(err)
	}
	sql := stdout.String()
	if !strings.Contains(sql, "BEGIN READ ONLY") || strings.Contains(sql, "$1") || !strings.Contains(sql, "p.id=139") {
		t.Fatal("invalid export SQL")
	}
	if !strings.Contains(sql, "version DESC,doc_id DESC") || !strings.Contains(sql, "s.deleted_at IS NULL") {
		t.Fatal("incorrect publication selection")
	}
	t.Setenv("DATABASE_URL", "")
	for _, args := range [][]string{{}, {"--page-id", "-1"}, {"unexpected"}, {"--input", filepath.Join(t.TempDir(), "missing")}} {
		if err := run(args, &bytes.Buffer{}, &bytes.Buffer{}); err == nil {
			t.Fatalf("accepted args %v", args)
		}
	}
}

func TestRunIncludesTitleOnlyPublicationWithoutDraftFallback(t *testing.T) {
	var publication map[string]any
	if err := json.Unmarshal([]byte(validPublication), &publication); err != nil {
		t.Fatal(err)
	}
	publication["content"] = []any{}
	publication["text"] = []any{}
	// Extra draft state is never part of the published-node extraction contract.
	publication["draft"] = map[string]any{"text": "Private unpublished draft"}
	raw, err := json.Marshal(publication)
	if err != nil {
		t.Fatal(err)
	}
	input := filepath.Join(t.TempDir(), "title-only.jsonl")
	if err := os.WriteFile(input, append(raw, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if err := run([]string{"--input", input}, &stdout, &stderr); err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &document); err != nil {
		t.Fatal(err)
	}
	if len(document) != 8 || document["bodyText"] != "" || document["title"] != "Title" {
		t.Fatalf("unexpected title-only record: %s", stdout.Bytes())
	}
	if strings.Contains(stdout.String(), "Private unpublished draft") || !strings.Contains(stderr.String(), "0 failed") {
		t.Fatal("draft content leaked or title-only generation failed")
	}
}
