package core

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/render"
)

// Only validated provider claims can populate the bearer identity context.
type bearerIdentityKey struct{}
type bearerIdentity struct {
	Subject, Name, Username, Email string
	EmailVerified                  bool
}

type BearerAccessTokenValidator struct {
	tokens  *BrowserAccessTokenValidator
	clients map[string]bool
}

// Client IDs are an explicit deployment allowlist, never inferred from a token.
func NewBearerAccessTokenValidator(tokens *BrowserAccessTokenValidator, allowedClients string) (*BearerAccessTokenValidator, error) {
	if tokens == nil || strings.TrimSpace(allowedClients) == "" {
		return nil, errors.New("bearer validation requires ZITADEL_BEARER_CLIENT_IDS")
	}
	clients := make(map[string]bool)
	for _, client := range strings.Split(allowedClients, ",") {
		client = strings.TrimSpace(client)
		if client == "" || strings.ContainsAny(client, " \t\r\n*") {
			return nil, errors.New("ZITADEL_BEARER_CLIENT_IDS must contain explicit comma-separated client IDs")
		}
		clients[client] = true
	}
	return &BearerAccessTokenValidator{tokens: tokens, clients: clients}, nil
}

func (v *BearerAccessTokenValidator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fail := func(status int, message string) {
			w.Header().Set("Cache-Control", "no-store")
			if status == http.StatusUnauthorized {
				w.Header().Set("WWW-Authenticate", `Bearer realm="api"`)
			}
			render.Status(r, status)
			render.Render(w, r, NewFailedResponse(status, FAILURE, message, ""))
		}
		parts := strings.Fields(r.Header.Get("Authorization"))
		if len(r.Header.Values("Authorization")) != 1 || len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.Contains(parts[1], ",") {
			fail(http.StatusUnauthorized, "AUTH_REQUIRED")
			return
		}
		result, err := v.tokens.introspectAccessToken(r.Context(), parts[1], func(id string) bool { return v.clients[id] })
		if err != nil {
			if errors.Is(err, errBrowserTokenInvalid) {
				fail(http.StatusUnauthorized, "AUTH_REQUIRED")
			} else {
				fail(http.StatusServiceUnavailable, "AUTH_UNAVAILABLE")
			}
			return
		}
		username := result.PreferredUsername
		if username == "" {
			username = result.Username
		}
		identity := bearerIdentity{Subject: result.Subject, Name: result.Name, Username: username, Email: result.Email, EmailVerified: bool(result.EmailVerified)}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), bearerIdentityKey{}, identity)))
	})
}
