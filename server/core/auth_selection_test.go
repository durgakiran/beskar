package core

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestInvitationTokenDoesNotOverrideSession(t *testing.T) {
	for _, signedIn := range []bool{true, false} {
		t.Run(map[bool]string{true: "signed in", false: "signed out"}[signedIn], func(t *testing.T) {
			cookiePath := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "" {
					t.Fatal("invitation promoted to Authorization")
				}
				if r.URL.Query().Get("token") != "invitation-token" {
					t.Fatal("invitation token was lost")
				}
				cookie, err := r.Cookie("session")
				if err != nil || cookie.Value != "signed-in" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				w.WriteHeader(http.StatusOK)
			})
			bearerPath := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Error("invitation entered JWT verifier")
				w.WriteHeader(500)
			})
			router := chi.NewRouter()
			router.Mount("/api/v1/invite", SelectAuthentication(cookiePath, bearerPath, false))
			req := httptest.NewRequest("GET", "/api/v1/invite/user/details?token=invitation-token", nil)
			if signedIn {
				req.AddCookie(&http.Cookie{Name: "session", Value: "signed-in"})
			}
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			want := http.StatusUnauthorized
			if signedIn {
				want = http.StatusOK
			}
			if response.Code != want {
				t.Fatalf("got %d want %d", response.Code, want)
			}
		})
	}
}

func TestAuthenticationCredentialSelection(t *testing.T) {
	for _, tc := range []struct {
		name, method, header string
		allow                bool
		want                 string
	}{
		{"ordinary query uses session", "GET", "", false, "cookie"},
		{"desktop header wins over invite query", "GET", "Bearer desktop.jwt.token", false, "Bearer desktop.jwt.token"},
		{"malformed header does not fall back to session", "GET", "Bearer", false, "Bearer"},
		{"media query compatibility", "GET", "", true, "Bearer query-token"},
		{"media HEAD compatibility", "HEAD", "", true, "Bearer query-token"},
		{"media write requires normal authentication", "POST", "", true, "cookie"},
		{"explicit header wins over media query", "GET", "Bearer explicit.jwt.token", true, "Bearer explicit.jwt.token"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := ""
			cookie := http.HandlerFunc(func(http.ResponseWriter, *http.Request) { got = "cookie" })
			bearer := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { got = r.Header.Get("Authorization") })
			req := httptest.NewRequest(tc.method, "/resource?token=query-token", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			SelectAuthentication(cookie, bearer, tc.allow).ServeHTTP(httptest.NewRecorder(), req)
			if got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
			if req.Header.Get("Authorization") != tc.header {
				t.Fatal("mutated incoming request headers")
			}
		})
	}
}

func TestMalformedBearerHeadersReturnUnauthorizedWithoutPanic(t *testing.T) {
	for _, header := range []string{"", "Bearer", "Bearer ", "Basic abc", "Bearer one two", "Bearer\t"} {
		t.Run(header, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/api/v1/invite/user/details", nil)
			request.Header.Set("Authorization", header)
			response := httptest.NewRecorder()
			(&BearerAccessTokenValidator{}).Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("malformed header authorized") })).ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("got %d", response.Code)
			}
		})
	}
}
