package transport

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"beskar/desktop/config"
)

const testAttachment = "/api/v1/attachments/57a825c2-b600-48e4-a1b2-74eb7e5138e7"

func TestAttachmentDownload(t *testing.T) {
	data := []byte("binary\x00attachment\xff\n")
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != testAttachment || r.Method != "GET" || r.Header.Get("Authorization") != "Bearer test-token" {
			t.Error("incorrect authenticated download request")
		}
		_, _ = w.Write(data)
	}))
	defer server.Close()
	trustBackendCertificate(t, server)
	service := New(&config.AppConfig{ServerURL: server.URL}, func() string { return "test-token" })
	dir := t.TempDir()
	destination := filepath.Join(dir, "chosen.bin")
	service.savePath = func(name string) (string, error) {
		if name != "test.bin" {
			t.Errorf("unsafe suggested filename: %q", name)
		}
		return destination, nil
	}
	saved, err := service.SaveAttachment(context.Background(), testAttachment, `..\folder/test.bin`)
	if err != nil || !saved {
		t.Fatalf("download failed: %v", err)
	}
	got, err := os.ReadFile(destination)
	if err != nil || string(got) != string(data) {
		t.Fatal("download bytes changed")
	}
	service.savePath = func(string) (string, error) { return "", nil }
	if saved, err := service.SaveAttachment(context.Background(), testAttachment, "cancelled.bin"); saved || err != nil {
		t.Fatalf("cancellation: saved=%v error=%v", saved, err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatal("cancel left an extra file")
	}
}

func TestRejectAttachmentPathsBeforeDownload(t *testing.T) {
	service := New(&config.AppConfig{ServerURL: "https://unused.example"}, func() string { return "test-token" })
	for _, path := range []string{"https://evil.example" + testAttachment, "/api/v1/profile/details", testAttachment + "?redirect=other", "/api/v1/attachments/../../secret"} {
		if saved, err := service.SaveAttachment(context.Background(), path, "test"); err == nil || saved {
			t.Errorf("invalid download accepted: %s", path)
		}
	}
	service.token = func() string { return "" }
	if saved, err := service.SaveAttachment(context.Background(), testAttachment, "test"); err == nil || saved {
		t.Fatal("anonymous download accepted")
	}
}

func TestDownloadFailureDoesNotOpenDialog(t *testing.T) {
	for _, status := range []int{http.StatusForbidden, http.StatusFound, http.StatusOK} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if status == http.StatusFound {
					w.Header().Set("Location", "https://unused.example/")
				}
				w.WriteHeader(status)
				if status == http.StatusOK {
					_, _ = w.Write([]byte(strings.Repeat("x", 10*1024*1024+1)))
				}
			}))
			defer server.Close()
			trustBackendCertificate(t, server)
			service := New(&config.AppConfig{ServerURL: server.URL}, func() string { return "test-token" })
			service.savePath = func(string) (string, error) { t.Error("dialog opened for failed download"); return "", nil }
			if saved, err := service.SaveAttachment(context.Background(), testAttachment, "test"); err == nil || saved {
				t.Fatal("failed download accepted")
			}
		})
	}
}

func TestDownloadWriteFailureLeavesNoTemporaryFile(t *testing.T) {
	dir := t.TempDir()
	destination := filepath.Join(dir, "existing-directory")
	if err := os.Mkdir(destination, 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeDownload(destination, []byte("test")); err == nil {
		t.Fatal("directory overwritten")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 || !entries[0].IsDir() {
		t.Fatal("temporary download left behind")
	}
}
