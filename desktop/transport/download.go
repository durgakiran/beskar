package transport

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"beskar/desktop/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var attachmentPath = regexp.MustCompile(`^/api/v1/attachments/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// SaveAttachment downloads only an attachment on the configured backend. The
// token stays in Go, and the destination always comes from a native save dialog.
func (s *Service) SaveAttachment(ctx context.Context, path, fileName string) (bool, error) {
	if !attachmentPath.MatchString(path) {
		return false, errors.New("invalid attachment path")
	}
	token := s.token()
	if token == "" {
		return false, errors.New("sign in required")
	}
	client := &http.Client{
		Transport: config.NewHTTPTransport(), Timeout: 60 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	defer client.CloseIdleConnections()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(s.cfg.ServerURL, "/")+path, nil)
	if err != nil {
		return false, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		return false, errors.New("unable to download attachment")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false, fmt.Errorf("download failed (%d)", response.StatusCode)
	}
	// Matches the application's 10 MB attachment limit. Validate before opening
	// the dialog so failed downloads never create an empty destination file.
	const maxBytes = 10 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return false, errors.New("unable to read attachment")
	}
	if len(data) > maxBytes {
		return false, errors.New("attachment exceeds the 10 MB download limit")
	}
	name := filepath.Base(strings.ReplaceAll(fileName, "\\", "/"))
	if name == "." || name == "/" || name == "" {
		name = "attachment"
	}
	choosePath := s.savePath
	if choosePath == nil {
		choosePath = func(name string) (string, error) {
			return application.Get().Dialog.SaveFile().SetFilename(name).PromptForSingleSelection()
		}
	}
	destination, err := choosePath(name)
	if err != nil || destination == "" {
		return false, err
	}
	if err := writeDownload(destination, data); err != nil {
		return false, err
	}
	return true, nil
}

func writeDownload(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".attachment-download-*")
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
