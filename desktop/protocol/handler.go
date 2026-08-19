package protocol

import (
	"net/url"
)

// CodeChan is used to pass the authorization code from the URL handler back to the AuthService
var CodeChan = make(chan string, 1)

// HandleURL should be called by the Wails application when the app is launched via a custom URL
// e.g. beskar://callback?code=...
func HandleURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	
	code := u.Query().Get("code")
	if code != "" {
		// Non-blocking send
		select {
		case CodeChan <- code:
		default:
		}
	}
	
	return nil
}
