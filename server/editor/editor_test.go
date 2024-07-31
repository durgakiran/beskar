package editor

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSaveDoc(t *testing.T) {
	req, err := http.NewRequest("POST", "/save", nil)

	if err != nil {
		t.Errorf("Error creating a new request: %v", err)
	}
	rr := httptest.NewRecorder()
	handler := http.HandlerFunc(saveDoc)

	handler.ServeHTTP(rr, req)
	if status := rr.Code; status != http.StatusForbidden {
		t.Errorf("Handler returned wrong status code. Expected: %d. Got: %d.", http.StatusForbidden, status)
	}

}
