package main

import (
	"context"
	"hash/fnv"
	"reflect"
	"strings"
	"testing"

	"beskar/desktop/auth"
	"beskar/desktop/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestDesktopAuthenticationBindingBoundary(t *testing.T) {
	// Exercise Wails' real registry with the exact service list used at startup.
	// No app.Run, credential loading, or keychain access occurs in this test.
	_ = application.New(application.Options{})
	bindings := application.NewBindings(nil, nil)
	for _, service := range desktopServices(&auth.Manager{}, &config.ConfigService{Config: &config.AppConfig{}}) {
		if _, exposed := service.Instance().(*auth.Manager); exposed {
			t.Fatal("native auth manager must never be registered with Wails")
		}
		if err := bindings.Add(service); err != nil {
			t.Fatal(err)
		}
	}
	facadeType := reflect.TypeOf((*auth.UIAuthService)(nil))
	if facadeType.NumMethod() != 4 {
		t.Fatal("review the renderer auth allowlist before adding methods")
	}
	for _, method := range []string{"Login", "Logout", "IsAuthenticated", "GetStatus"} {
		name := "beskar/desktop/auth.UIAuthService." + method
		bound := bindings.Get(&application.CallOptions{MethodName: name})
		if bound == nil || bindings.GetByID(bound.ID) != bound {
			t.Fatalf("missing renderer method: %s", method)
		}
	}
	for _, owner := range []string{"AuthService", "Manager", "UIAuthService"} {
		for _, method := range []string{"GetAccessToken", "GetRefreshToken", "GetUserInfo", "Initialize", "HandleCallback"} {
			name := "beskar/desktop/auth." + owner + "." + method
			hash := fnv.New32a()
			_, _ = hash.Write([]byte(name))
			if bindings.Get(&application.CallOptions{MethodName: name}) != nil || bindings.GetByID(hash.Sum32()) != nil {
				t.Errorf("sensitive native method is callable from JS: %s", name)
			}
		}
	}
	// An attacker retaining the old generated wrappers must not retain access.
	for _, id := range []uint32{3776374147, 3413322022, 911977689} {
		if bindings.GetByID(id) != nil {
			t.Errorf("legacy sensitive binding is still registered: %d", id)
		}
	}
	status := bindings.Get(&application.CallOptions{MethodName: "beskar/desktop/auth.UIAuthService.IsAuthenticated"})
	result, err := status.Call(context.Background(), nil)
	if err != nil || result != false {
		t.Fatalf("status call failed: result=%v error=%v", result, err)
	}
	// Wails must inject the call context, rather than require a JS argument.
	login := bindings.Get(&application.CallOptions{MethodName: "beskar/desktop/auth.UIAuthService.Login"})
	if _, err := login.Call(context.Background(), nil); err == nil || !strings.Contains(err.Error(), "application not configured") {
		t.Fatalf("context-aware login binding failed: %v", err)
	}
	diagnostic := bindings.Get(&application.CallOptions{MethodName: "beskar/desktop/auth.UIAuthService.GetStatus"})
	value, err := diagnostic.Call(context.Background(), nil)
	if _, ok := value.(auth.Status); err != nil || !ok {
		t.Fatal("nonsecret status binding failed")
	}
	statusType := reflect.TypeOf(auth.Status{})
	allowed := map[string]bool{"Code": true, "Message": true, "RequiresSignIn": true, "LocalSignedOut": true, "Revocation": true}
	if statusType.NumField() != len(allowed) {
		t.Fatal("review status fields before exposing more renderer data")
	}
	for i := 0; i < statusType.NumField(); i++ {
		if !allowed[statusType.Field(i).Name] {
			t.Fatal("unreviewed field in renderer auth status")
		}
	}
}
