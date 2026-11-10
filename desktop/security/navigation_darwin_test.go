//go:build darwin && cgo

package security

import "testing"

func TestTrustedMainURL(t *testing.T) {
	for _, url := range []string{"wails://localhost/index.desktop.html", "wails://localhost/index.desktop.html#/edit/space/141"} {
		if !trustedMainURL(url) {
			t.Errorf("trusted application URL rejected: %s", url)
		}
	}
	for _, url := range []string{"https://evil.example/", "javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "about:blank", "wails://localhost.evil.example/index.desktop.html", "wails://user@localhost/index.desktop.html", "wails://localhost:1234/index.desktop.html", "wails://localhost/api/v1/media/file", "wails://localhost/other.html"} {
		if trustedMainURL(url) {
			t.Errorf("untrusted top-level navigation accepted: %s", url)
		}
	}
}
