package core

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-chi/render"
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
	fmt.Println(os.Getenv("KC_REALM_URL"))
	provider, err := oidc.NewProvider(ctx, os.Getenv("KC_REALM_URL"))
	if err != nil {
		slog.Error("authorisation failed while getting the provider: " + err.Error())
		return errors.New(err.Error())

	}
	oidcConfig := &oidc.Config{
		// ClientID: os.Getenv("KC_CLIENT_ID"),
		SkipClientIDCheck: true,
	}
	verifier := provider.Verifier(oidcConfig)
	idToken, err := verifier.Verify(ctx, t.value)
	if err != nil {
		slog.Error("authorisation failed while verifying the token: " + err.Error())
		return errors.New(err.Error())
	}
	var claims Claims

	err = idToken.Claims(&claims)
	t.Claims = claims
	return nil
}

func AuthMiddleWare(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		fmt.Println(token)
		if len(token) == 0 {
			render.Status(r, http.StatusUnauthorized)
			render.Render(w, r, NewFailedResponse(401, "Authorization token not provided", ""))
			return
		}
		Itoken := tokenType{value: strings.Split(token, " ")[1]}
		err := Itoken.authenticate()
		if err != nil {
			render.Status(r, http.StatusUnauthorized)
			render.Render(w, r, NewFailedResponse(401, err.Error(), ""))
			return
		}
		ctx := context.WithValue(r.Context(), "claims", Itoken.Claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
