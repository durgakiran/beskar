package search

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSearchHTTPValidationAndAuthentication(t *testing.T) {
	for _, test := range []struct {
		query  string
		auth   bool
		status int
	}{
		{"q=roadmap", false, 401}, {"", true, 400}, {"q=a", true, 400}, {"q=%00hello", true, 400},
		{"q=%ff%ff", true, 400}, {"q=%zz", true, 400}, {"q=" + strings.Repeat("a", 201), true, 400},
		{"q=valid&limit=0", true, 400}, {"q=valid&limit=21", true, 400}, {"q=valid&limit=x", true, 400},
	} {
		t.Run(test.query, func(t *testing.T) {
			called := false
			c := controller{actor: func(*http.Request) (uuid.UUID, bool) { return uuid.New(), test.auth }, search: func(context.Context, uuid.UUID, string, int) ([]Result, error) { called = true; return nil, nil }}
			r := httptest.NewRequest("GET", "/documents?"+test.query, nil)
			w := httptest.NewRecorder()
			c.documents(w, r)
			if w.Code != test.status || called {
				t.Fatalf("status=%d called=%t", w.Code, called)
			}
			if w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("private search was cacheable")
			}
		})
	}
}

func TestSearchHTTPUsesAuthenticatedActorAndBoundedContext(t *testing.T) {
	actor := uuid.New()
	c := controller{actor: func(*http.Request) (uuid.UUID, bool) { return actor, true }, search: func(ctx context.Context, got uuid.UUID, q string, limit int) ([]Result, error) {
		if got != actor || q != "roadmap" || limit != 5 {
			t.Fatal("request did not use authenticated actor and validated query")
		}
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 5*time.Second {
			t.Fatal("search was not time-bounded")
		}
		return []Result{}, nil
	}}
	r := httptest.NewRequest("GET", "/documents?q=%20roadmap%20&limit=5&userId=attacker", nil)
	w := httptest.NewRecorder()
	c.documents(w, r)
	if w.Code != 200 {
		t.Fatalf("status=%d", w.Code)
	}
	var response struct {
		Status string `json:"status"`
		Data   struct {
			Results []Result `json:"results"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || response.Status != "success" || response.Data.Results == nil {
		t.Fatal("invalid empty response")
	}
}

func TestSearchHTTPDoesNotExposeBackendError(t *testing.T) {
	c := controller{actor: func(*http.Request) (uuid.UUID, bool) { return uuid.New(), true }, search: func(context.Context, uuid.UUID, string, int) ([]Result, error) {
		return nil, errors.New("private SQL credentials and content")
	}}
	w := httptest.NewRecorder()
	c.documents(w, httptest.NewRequest("GET", "/documents?q=valid", nil))
	if w.Code != 503 || strings.Contains(w.Body.String(), "private SQL") {
		t.Fatal("backend error leaked")
	}
}
