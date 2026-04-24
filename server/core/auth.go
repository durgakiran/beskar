package core

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/zitadel/oidc/v3/pkg/client/rp"
	httphelper "github.com/zitadel/oidc/v3/pkg/http"
	zoidc "github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
	openid "github.com/zitadel/zitadel-go/v3/pkg/authentication/oidc"
	"github.com/zitadel/zitadel-go/v3/pkg/zitadel"
)

type tokenType struct {
	value  string
	Claims Claims
}

type Claims struct {
	Email         string      `json:"email"`
	EmailVerified bool        `json:"email_verified"`
	Claims        DefaultRole `json:"https://hasura.io/jwt/claims"`
}

type DefaultRole struct {
	DefaultRole  string   `json:"x-hasura-default-role"`
	UserId       string   `json:"x-hasura-user-id"`
	AllowedRoles []string `json:"x-hasura-allowed-roles"`
}

func (t *tokenType) authenticate() error {
	insecureSkipVerify, err := strconv.ParseBool(strings.TrimSpace(os.Getenv("INSECURE_SKIP_VERIFY")))
	if err != nil {
		insecureSkipVerify = false
	}

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecureSkipVerify},
	}
	client := &http.Client{
		Timeout:   time.Duration(6000) * time.Second,
		Transport: tr,
	}
	ctx := oidc.ClientContext(context.Background(), client)
	provider, err := oidc.NewProvider(ctx, IssuerBaseURL())
	if err != nil {
		Logger.Error("authorisation failed while getting the provider: " + err.Error())
		return errors.New(err.Error())

	}
	oidcConfig := &oidc.Config{
		SkipClientIDCheck: true,
	}
	verifier := provider.Verifier(oidcConfig)
	idToken, err := verifier.Verify(ctx, t.value)
	if err != nil {
		Logger.Error("authorisation failed while verifying the token: " + err.Error())
		return errors.New(err.Error())
	}
	var claims Claims

	err = idToken.Claims(&claims)
	if err != nil {
		return err
	}
	t.Claims = claims
	return nil
}

func AuthMiddleWare(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if len(token) == 0 {
			render.Status(r, http.StatusUnauthorized)
			render.Render(w, r, NewFailedResponse(401, FAILURE, "Authorization token not provided", ""))
			return
		}
		Itoken := tokenType{value: strings.Split(token, " ")[1]}
		err := Itoken.authenticate()
		if err != nil {
			render.Status(r, http.StatusUnauthorized)
			render.Render(w, r, NewFailedResponse(401, FAILURE, err.Error(), ""))
			return
		}
		ctx := context.WithValue(r.Context(), "claims", Itoken.Claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// zitadel configuration

var authN *authentication.Authenticator[*openid.UserInfoContext[*zoidc.IDTokenClaims, *zoidc.UserInfo]]
var authNLock = &sync.Mutex{}

const zitadelOrgScopePrefix = "urn:zitadel:iam:org:id:"

func zitadelAuthScopes() []string {
	scopes := []string{zoidc.ScopeOpenID, zoidc.ScopeProfile, zoidc.ScopeEmail}
	orgID := strings.TrimSpace(os.Getenv("ZITADEL_REGISTRATION_ORG_ID"))
	if orgID == "" {
		return scopes
	}
	return append(scopes, fmt.Sprintf("%s%s", zitadelOrgScopePrefix, orgID))
}

func zitadelRedirectURI() string {
	return fmt.Sprintf("%s/auth/callback", os.Getenv("SERVER_URL"))
}

func zitadelClientAuthentication() openid.ClientAuthentication {
	key := os.Getenv("KEY")
	return openid.PKCEAuthentication(
		os.Getenv("CLIENT_ID"),
		zitadelRedirectURI(),
		zitadelAuthScopes(),
		httphelper.NewCookieHandler([]byte(key), []byte(key)),
	)
}

func ZitadelAuthenticator() *authentication.Authenticator[*openid.UserInfoContext[*zoidc.IDTokenClaims, *zoidc.UserInfo]] {
	issuerURL := IssuerHost()
	if authN == nil {
		authNLock.Lock()
		defer authNLock.Unlock()
		if authN == nil {
			authNClient, err := authentication.New(
				context.Background(),
				zitadel.New(issuerURL),
				os.Getenv("KEY"),
				openid.WithCodeFlow[*openid.UserInfoContext[*zoidc.IDTokenClaims, *zoidc.UserInfo], *zoidc.IDTokenClaims, *zoidc.UserInfo](zitadelClientAuthentication()),
				authentication.WithLogger[*openid.UserInfoContext[*zoidc.IDTokenClaims, *zoidc.UserInfo]](SlogLogger),
				authentication.WithExternalSecure[*openid.UserInfoContext[*zoidc.IDTokenClaims, *zoidc.UserInfo]](true),
			)
			authN = authNClient
			if err != nil {
				Logger.Error(err.Error())
				os.Exit(1)
			}

		}
	}
	return authN
}

func ZitadelRegisterHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stateParam, err := (&authentication.State{RequestedURI: ""}).Encrypt(os.Getenv("KEY"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		relyingParty, err := zitadelClientAuthentication()(r.Context(), zitadel.New(IssuerHost()).Origin())
		if err != nil {
			Logger.Error("registration failed while creating relying party: " + err.Error())
			http.Error(w, "failed to initialize registration", http.StatusInternalServerError)
			return
		}

		rp.AuthURLHandler(func() string { return stateParam }, relyingParty, rp.WithPromptURLParam("create"))(w, r)
	}
}

func sanitizeAuthReturnTo(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsAny(value, "\\\r\n\t") {
		return "/"
	}
	if !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return "/"
	}

	path := value
	if idx := strings.IndexAny(path, "?#"); idx >= 0 {
		path = path[:idx]
	}
	lowerPath := strings.ToLower(path)
	if lowerPath == "/auth" || strings.HasPrefix(lowerPath, "/auth/") {
		return "/"
	}

	return value
}

func ZitadelLoginHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		returnTo := sanitizeAuthReturnTo(r.URL.Query().Get("returnTo"))
		ZitadelAuthenticator().Authenticate(w, r, returnTo)
	}
}

func ZitadelAuthRouter() http.Handler {
	r := chi.NewRouter()
	r.Get("/register", ZitadelRegisterHandler())
	r.Get("/login", ZitadelLoginHandler())
	r.Handle("/*", ZitadelAuthenticator())
	return r
}

func ZitadelMiddleware() *authentication.Interceptor[*openid.UserInfoContext[*zoidc.IDTokenClaims, *zoidc.UserInfo]] {
	return authentication.Middleware(ZitadelAuthenticator())
}

func Authenticated(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authentication.IsAuthenticated(r.Context()) {
			next.ServeHTTP(w, r)
		} else {
			render.Status(r, http.StatusUnauthorized)
			render.Render(w, r, NewFailedResponse(401, FAILURE, "Not authenticated", ""))
		}
	})
}
