package pdfexport

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestRejectsInvalidPDFBeforeOpeningDialog(t *testing.T) {
	service := &Service{}
	for _, input := range []string{"not base64", base64.StdEncoding.EncodeToString([]byte("not a PDF"))} {
		saved, err := service.SavePDF("test.pdf", input)
		if err == nil || saved {
			t.Fatal("invalid PDF accepted")
		}
	}
}
func TestAtomicPDFWrite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "export.pdf")
	data := []byte("%PDF-1.7\nTest")
	if err := writePDF(path, data); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(data) {
		t.Fatalf("incorrect saved PDF: %v", err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatal("temporary file left behind")
	}
}
func TestWriteFailurePreservesDestination(t *testing.T) {
	dir := t.TempDir()
	if err := writePDF(dir, []byte("%PDF-1.7")); err == nil {
		t.Fatal("directory replaced")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatal("temporary file left behind after failure")
	}
}
