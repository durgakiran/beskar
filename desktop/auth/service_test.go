package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeUIAuthManager struct {
	authed          bool
	err             error
	loginContext    context.Context
	logins, logouts int
}

func (m *fakeUIAuthManager) Login(ctx context.Context) error {
	m.loginContext = ctx
	m.logins++
	return m.err
}
func (m *fakeUIAuthManager) GetStatus() Status     { return Status{Code: "test", Message: "Safe status"} }
func (m *fakeUIAuthManager) Logout() error         { m.logouts++; return m.err }
func (m *fakeUIAuthManager) IsAuthenticated() bool { return m.authed }

func TestUIAuthFacadeDelegatesOnlyNonsecretActions(t *testing.T) {
	manager := &fakeUIAuthManager{authed: true, err: errors.New("provider unavailable")}
	service := &UIAuthService{manager: manager}
	if service.GetStatus().Message != "Safe status" {
		t.Fatal("status forwarding failed")
	}
	if !service.IsAuthenticated() {
		t.Fatal("authentication status lost")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if service.Login(ctx) != manager.err || manager.logins != 1 || manager.loginContext != ctx {
		t.Fatal("login outcome lost")
	}
	cancel()
	if manager.loginContext.Err() != context.Canceled {
		t.Fatal("facade lost native cancellation")
	}
	if service.Logout() != manager.err || manager.logouts != 1 {
		t.Fatal("logout outcome lost")
	}
}

func TestFacadeAndNativeTransportShareTheManager(t *testing.T) {
	manager := &Manager{accessToken: "test-access-token", expiry: time.Now().Add(time.Hour)}
	service := NewUIAuthService(manager)
	if !service.IsAuthenticated() || manager.GetAccessToken() != "test-access-token" {
		t.Fatal("facade and native transport do not share the authenticated session")
	}
}
