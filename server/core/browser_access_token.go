package core

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/render"
	"github.com/zitadel/oidc/v3/pkg/client/rs"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
	openid "github.com/zitadel/zitadel-go/v3/pkg/authentication/oidc"
	"golang.org/x/oauth2"
)

type browserAuthContext = openid.UserInfoContext[*oidc.IDTokenClaims, *oidc.UserInfo]

var errBrowserTokenInvalid = errors.New("browser access token is invalid")

// BrowserAccessTokenValidator validates the token stored by the OIDC callback,
// not a credential supplied by JavaScript. Expired session tokens are refreshed.
type BrowserAccessTokenValidator struct {
	resourceServer rs.ResourceServer
	refreshConfig  oauth2.Config
	refreshClient  *http.Client
	sessions       *browserSessionStore
	issuer         string
	clientID       string
	audience       string
	now            func() time.Time
}

type browserTokenConfig struct {
	issuer, clientID, clientSecret, audience string
}

// NewBrowserAccessTokenValidator uses the same confidential client credentials as login. KEY is a
// session encryption key and must never be reused as an introspection secret.
func NewBrowserAccessTokenValidator() (*BrowserAccessTokenValidator, error) {
	v, err := newBrowserAccessTokenValidator(browserTokenConfig{
		issuer:       IssuerBaseURL(),
		clientID:     strings.TrimSpace(os.Getenv("ZITADEL_CLIENT_ID")),
		audience:     strings.TrimSpace(os.Getenv("ZITADEL_API_AUDIENCE")),
		clientSecret: os.Getenv("ZITADEL_CLIENT_SECRET"),
	}, &http.Client{
		Timeout: 10 * time.Second,
		// Never forward credentials to a redirect target. TLS uses system trust.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	})
	if err == nil {
		v.sessions = browserSessions
	}
	return v, err
}

func newBrowserAccessTokenValidator(cfg browserTokenConfig, client *http.Client) (*BrowserAccessTokenValidator, error) {
	issuer, err := url.Parse(cfg.issuer)
	if err != nil || issuer.Scheme != "https" || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" {
		return nil, errors.New("browser token validation requires an HTTPS ISSUER_URL")
	}
	if cfg.clientID == "" || cfg.audience == "" || strings.TrimSpace(cfg.clientSecret) == "" {
		return nil, errors.New("browser token validation requires ZITADEL_CLIENT_ID, ZITADEL_CLIENT_SECRET and ZITADEL_API_AUDIENCE")
	}
	// Zitadel's endpoints are fixed under the configured issuer. No per-request
	// discovery, token cache, redirect following, or insecure TLS override.
	base := strings.TrimRight(cfg.issuer, "/")
	// Copy the client so diagnostics do not mutate a caller's shared transport.
	diagnosticClient := *client
	transport := client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	diagnosticClient.Transport = introspectionDiagnosticTransport{base: transport}
	resourceServer, err := rs.NewResourceServerClientCredentials(context.Background(), cfg.issuer,
		cfg.clientID, cfg.clientSecret,
		rs.WithClient(&diagnosticClient), rs.WithStaticEndpoints(base+"/oauth/v2/token", base+"/oauth/v2/introspect"))
	if err != nil {
		return nil, err
	}
	return &BrowserAccessTokenValidator{resourceServer: resourceServer, issuer: cfg.issuer,
		clientID: cfg.clientID, audience: cfg.audience, now: time.Now,
		refreshClient: client, refreshConfig: oauth2.Config{ClientID: cfg.clientID, ClientSecret: cfg.clientSecret, Endpoint: oauth2.Endpoint{TokenURL: base + "/oauth/v2/token", AuthStyle: oauth2.AuthStyleInHeader}}}, nil
}

func (v *BrowserAccessTokenValidator) validate(ctx context.Context, session *browserAuthContext) error {
	if session.UserInfo == nil || session.UserInfo.Subject == "" || session.Tokens == nil || session.Tokens.Token == nil {
		return errBrowserTokenInvalid
	}
	token := session.Tokens.Token
	if token.AccessToken == "" || !strings.EqualFold(token.TokenType, "Bearer") || !token.Expiry.After(v.now()) {
		return errBrowserTokenInvalid
	}
	result, err := rs.Introspect[*oidc.IntrospectionResponse](ctx, v.resourceServer, token.AccessToken)
	if err != nil {
		// Never log err.Error(): the SDK includes provider response bodies in errors.
		reason := "request_or_response_error"
		var providerError *oidc.Error
		if errors.As(err, &providerError) {
			switch providerError.ErrorType {
			case oidc.InvalidClient, oidc.UnauthorizedClient, oidc.InvalidRequest, oidc.ServerError, oidc.AccessDenied:
				reason = string(providerError.ErrorType)
			default:
				reason = "oauth_error"
			}
		}
		SlogLogger.WarnContext(ctx, "browser token introspection failed", "reason", reason, "error_type", fmt.Sprintf("%T", err))
		// Includes invalid_client, rate limiting, malformed responses and network
		// errors: these are not evidence that the user's credentials were revoked.
		return errors.New("browser access token validation unavailable")
	}
	if result == nil {
		SlogLogger.WarnContext(ctx, "browser token introspection failed", "reason", "null_response")
		return errors.New("browser access token validation unavailable")
	}
	if !result.Active || result.Subject != session.UserInfo.Subject || result.Issuer != v.issuer ||
		result.ClientID != v.clientID || !strings.EqualFold(result.TokenType, "Bearer") ||
		!result.Expiration.AsTime().After(v.now()) || result.NotBefore.AsTime().After(v.now()) {
		return errBrowserTokenInvalid
	}
	for _, audience := range result.Audience {
		if audience == v.audience {
			return nil
		}
	}
	return errBrowserTokenInvalid
}

// Middleware resolves cookies directly so Redis failures cannot be swallowed by
// the SDK as anonymous sessions. Requests without cookies may reach public routes.
func (v *BrowserAccessTokenValidator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := authentication.Context[*browserAuthContext](r.Context())
		var err error
		if v.sessions != nil {
			if _, cookieErr := r.Cookie("zitadel.session"); errors.Is(cookieErr, http.ErrNoCookie) {
				next.ServeHTTP(w, r)
				return
			}
			session, err = v.prepareSession(r.Context(), v.sessions, browserSessionID(r))
		} else {
			if session == nil {
				next.ServeHTTP(w, r)
				return
			}
			err = v.validate(r.Context(), session)
		}
		if err != nil {
			if errors.Is(err, errBrowserStoreUnavailable) {
				SlogLogger.WarnContext(r.Context(), "browser session validation unavailable", "reason", "session_storage_unavailable")
			}
			status, message := http.StatusServiceUnavailable, "AUTH_UNAVAILABLE"
			if errors.Is(err, errBrowserTokenInvalid) {
				status, message = http.StatusUnauthorized, "AUTH_REQUIRED"
			}
			w.Header().Set("Cache-Control", "no-store")
			render.Status(r, status)
			render.Render(w, r, NewFailedResponse(status, FAILURE, message, ""))
			return
		}
		r = r.WithContext(authentication.WithAuthContext(r.Context(), session))
		next.ServeHTTP(w, r)
	})
}

// Logs status/categories only: no headers, URLs, tokens, cookies or response bodies.
type introspectionDiagnosticTransport struct{ base http.RoundTripper }

func (t introspectionDiagnosticTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(req)
	if err != nil {
		reason := "network_error"
		var tlsError *tls.CertificateVerificationError
		var dnsError *net.DNSError
		var networkError net.Error
		switch {
		case errors.Is(err, context.Canceled):
			reason = "canceled"
		case errors.Is(err, context.DeadlineExceeded):
			reason = "timeout"
		case errors.As(err, &tlsError):
			reason = "tls_certificate_error"
		case errors.As(err, &dnsError):
			reason = "dns_error"
		case errors.As(err, &networkError) && networkError.Timeout():
			reason = "timeout"
		}
		SlogLogger.WarnContext(req.Context(), "browser token introspection transport failed", "reason", reason)
	} else if response != nil && response.StatusCode != http.StatusOK {
		SlogLogger.WarnContext(req.Context(), "browser token introspection HTTP failure", "status", response.StatusCode)
	}
	return response, err
}
