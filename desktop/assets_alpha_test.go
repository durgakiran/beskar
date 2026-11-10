//go:build beskar_alpha

package main

import (
	"bytes"
	"io/fs"
	"net/http/httptest"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestAlphaServesFreshDesktopAssets(t *testing.T) {
	assets, err := fs.Sub(embeddedAssets, "ui/dist")
	if err != nil {
		t.Fatal(err)
	}
	desktop, err := fs.ReadFile(assets, "index.desktop.html")
	if err != nil {
		t.Fatal(err)
	}
	root, err := fs.ReadFile(assets, "index.html")
	if err != nil || !bytes.Equal(root, desktop) {
		t.Fatal("Wails root entry must be the desktop entry, not a stale web build")
	}
	recorder := httptest.NewRecorder()
	application.AssetFileServerFS(assets).ServeHTTP(recorder, httptest.NewRequest("GET", "/index.desktop.html", nil))
	if recorder.Code != 200 || !bytes.Equal(recorder.Body.Bytes(), desktop) {
		t.Fatal("packaged desktop entry is not served correctly")
	}
}
