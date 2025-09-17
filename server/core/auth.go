package core

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-chi/render"
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
	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Timeout:   time.Duration(6000) * time.Second,
		Transport: tr,
	}
	ctx := oidc.ClientContext(context.Background(), client)
	provider, err := oidc.NewProvider(ctx, os.Getenv("ISSUER_URL"))
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

func ZitadelAuthenticator() *authentication.Authenticator[*openid.UserInfoContext[*zoidc.IDTokenClaims, *zoidc.UserInfo]] {
	issuerURL := os.Getenv("ISSUER_URL")
	clientID := os.Getenv("CLIENT_ID")
	serverURL := os.Getenv("SERVER_URL")
	if authN == nil {
		authNLock.Lock()
		defer authNLock.Unlock()
		if authN == nil {
			authNClient, err := authentication.New(
				context.Background(),
				zitadel.New(issuerURL),
				os.Getenv("KEY"),
				openid.DefaultAuthentication(clientID, fmt.Sprintf("%s/auth/callback", serverURL), os.Getenv("KEY")),
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
