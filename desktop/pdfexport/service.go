package pdfexport

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Service only writes PDFs to a path selected in the native save dialog.
type Service struct{}

func (s *Service) SavePDF(fileName, encoded string) (bool, error) {
	if len(encoded) > 90*1024*1024 {
		return false, errors.New("PDF exceeds the 64 MB desktop export limit")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) > 64*1024*1024 || !bytes.HasPrefix(data, []byte("%PDF-")) {
		return false, errors.New("invalid PDF data")
	}
	name := filepath.Base(strings.ReplaceAll(fileName, "\\", "/"))
	if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
		name += ".pdf"
	}
	path, err := application.Get().Dialog.SaveFile().SetFilename(name).
		AddFilter("PDF document", "*.pdf").PromptForSingleSelection()
	if err != nil || path == "" {
		return false, err
	}
	if err := writePDF(path, data); err != nil {
		return false, err
	}
	return true, nil
}

// Write beside the destination and rename only once the PDF is complete.
func writePDF(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".pdf-export-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
