package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"beskar/desktop/config"
)

func callbackFor(tx *loginTransaction) string {
	return RedirectURI + "?" + url.Values{"state": {tx.state}, "code": {"test-code"}}.Encode()
}

func TestCallbackValidationAndSingleUse(t *testing.T) {
	s := &Manager{}
	// An unsolicited callback must be harmless even before initialization.
	s.HandleCallback(RedirectURI + "?code=unsolicited&state=unknown")
	tx, err := s.beginLogin(context.Background(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer s.finishLogin(tx)
	good := callbackFor(tx)
	for _, bad := range []string{
		"https://callback?state=" + tx.state + "&code=test-code",
		strings.Replace(good, "callback", "callback.evil", 1),
		strings.Replace(good, "callback", "user@callback", 1),
		strings.Replace(good, "callback", "callback:123", 1),
		strings.Replace(good, "callback?", "callback/?", 1),
		good + "#fragment", good + "&state=duplicate", good + "&%73tate=duplicate",
		good + "&code=duplicate", good + "&error=access_denied", good + "&bad=%zz",
		RedirectURI + "?code=test-code", strings.Replace(good, tx.state, "wrong-state", 1),
		RedirectURI + "?state=" + tx.state, RedirectURI + "?state=" + tx.state + "&code=",
		RedirectURI + "?state=" + tx.state + "&error=",
	} {
		s.HandleCallback(bad)
		if tx.responded || len(tx.result) != 0 {
			t.Fatal("invalid callback consumed the transaction")
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); s.HandleCallback(good) }()
	}
	wg.Wait()
	if !tx.responded || len(tx.result) != 1 {
		t.Fatal("callback was not consumed exactly once")
	}
	result := <-tx.result
	if result.code != "test-code" || result.err != nil {
		t.Fatal("valid response lost")
	}
	s.HandleCallback(good)
	if len(tx.result) != 0 {
		t.Fatal("replay accepted")
	}
}

func TestStaleCallbackCannotConsumeNewLogin(t *testing.T) {
	s := &Manager{}
	old, _ := s.beginLogin(context.Background(), time.Minute)
	oldCallback := callbackFor(old)
	s.finishLogin(old)
	current, _ := s.beginLogin(context.Background(), time.Minute)
	defer s.finishLogin(current)
	if old.state == current.state || old.verifier == current.verifier {
		t.Fatal("login secrets reused")
	}
	s.HandleCallback(oldCallback)
	if current.responded {
		t.Fatal("old callback consumed new login")
	}
	s.HandleCallback(callbackFor(current))
	if !current.responded {
		t.Fatal("new callback rejected")
	}
}

func TestLoginControlFlow(t *testing.T) {
	for _, outcome := range []string{"success", "denied", "provider error", "launch failure", "timeout", "cancel", "shutdown", "logout"} {
		t.Run(outcome, func(t *testing.T) {
			appCtx, stopApp := context.WithCancel(context.Background())
			defer stopApp()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			s := &Manager{ctx: appCtx}
			timeout := time.Minute
			if outcome == "timeout" {
				timeout = 10 * time.Millisecond
			}
			exchanges := 0
			var usedVerifier string
			err := s.runLogin(ctx, timeout, func(_ context.Context, tx *loginTransaction) error {
				usedVerifier = tx.verifier
				switch outcome {
				case "success":
					s.HandleCallback(callbackFor(tx))
				case "denied":
					s.HandleCallback(RedirectURI + "?state=" + tx.state + "&error=access_denied")
				case "provider error":
					s.HandleCallback(RedirectURI + "?state=" + tx.state + "&error=server_error&error_description=DO_NOT_DISPLAY")
				case "launch failure":
					return errors.New("browser unavailable")
				case "cancel":
					cancel()
				case "shutdown":
					stopApp()
				case "logout":
					s.cancelPendingLogin()
				}
				return nil
			}, func(ctx context.Context, code, verifier string) error {
				exchanges++
				if code != "test-code" || verifier != usedVerifier || ctx.Err() != nil {
					t.Fatal("incorrect code/verifier/context")
				}
				return nil
			})
			if (err == nil) != (outcome == "success") {
				t.Fatalf("unexpected outcome: %v", err)
			}
			if outcome != "success" && exchanges != 0 {
				t.Fatal("failed login exchanged a code")
			}
			if outcome == "success" && exchanges != 1 {
				t.Fatal("missing code exchange")
			}
			if err != nil && strings.Contains(err.Error(), "DO_NOT_DISPLAY") {
				t.Fatal("provider description leaked")
			}
			if s.pendingLogin != nil {
				t.Fatal("transaction not cleared")
			}
			// All outcomes, including failures, allow a fresh attempt.
			next, err := s.beginLogin(context.Background(), time.Minute)
			if err != nil {
				t.Fatal(err)
			}
			s.finishLogin(next)
		})
	}
}

func TestExpiredAndCancelledCallbacksRejected(t *testing.T) {
	for _, timeout := range []time.Duration{-time.Second, time.Minute} {
		s := &Manager{}
		tx, _ := s.beginLogin(context.Background(), timeout)
		if timeout > 0 {
			tx.cancel()
		}
		s.HandleCallback(callbackFor(tx))
		if tx.responded {
			t.Fatal("inactive callback accepted")
		}
		s.finishLogin(tx)
	}
}

func TestConcurrentLoginDoesNotReplacePendingTransaction(t *testing.T) {
	s := &Manager{}
	tx, _ := s.beginLogin(context.Background(), time.Minute)
	defer s.finishLogin(tx)
	var accepted atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.beginLogin(context.Background(), time.Minute); err == nil {
				accepted.Add(1)
			}
		}()
	}
	wg.Wait()
	if accepted.Load() != 0 || s.pendingLogin != tx {
		t.Fatal("pending login replaced")
	}
}

func TestCancellationAfterCallbackPreventsExchange(t *testing.T) {
	s := &Manager{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	err := s.runLogin(ctx, time.Minute, func(_ context.Context, tx *loginTransaction) error {
		s.HandleCallback(callbackFor(tx))
		cancel()
		return nil
	}, func(context.Context, string, string) error { t.Fatal("cancelled login exchanged code"); return nil })
	if err == nil || s.pendingLogin != nil {
		t.Fatal("cancellation was not cleaned up")
	}
}

func TestLoginCancellationInterruptsTokenExchange(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/oauth/v2/token" || r.Form.Get("code_verifier") != "test-verifier" || r.Form.Get("redirect_uri") != RedirectURI {
			t.Error("incorrect token request")
		}
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()
	s := &Manager{cfg: &config.AppConfig{ZitadelURL: server.URL, ClientID: "test-client"}, client: server.Client()}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.exchangeCode(ctx, "test-code", "test-verifier", s.currentGeneration()) }()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("token request not started")
	}
	cancel()
	select {
	case err := <-done:
		var provider *authFailure
		if !errors.As(err, &provider) || provider.code != "provider_cancelled" {
			t.Fatalf("exchange not cancelled: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("token exchange ignored cancellation")
	}
	if s.accessToken != "" {
		t.Fatal("cancelled exchange adopted tokens")
	}
}
