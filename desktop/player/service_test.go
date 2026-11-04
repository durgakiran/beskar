package player

import (
	"context"
	"math"
	"testing"
)

func TestRejectUntrustedPlayerInput(t *testing.T) {
	service := New()
	frame := Frame{Width: 640, Height: 360, ClipWidth: 640, ClipHeight: 360, ViewportWidth: 1000, ViewportHeight: 800}
	for _, video := range []string{"https://evil.example/", "../callback", "dQw4w9WgXcQ?token=secret", "", "<script>"} {
		if err := service.Show(context.Background(), "player", video, frame); err == nil {
			t.Errorf("accepted untrusted video %q", video)
		}
	}
	for _, id := range []string{"../player", "", "<iframe>"} {
		if err := service.Close(context.Background(), id); err == nil {
			t.Errorf("accepted unsafe player id %q", id)
		}
	}
	for _, bad := range []Frame{{}, {Width: math.NaN()}, {Width: math.Inf(1)}, {Width: 1e9}, {Width: -1, Height: 360, ViewportWidth: 1000, ViewportHeight: 800}} {
		if validFrame(bad) {
			t.Errorf("accepted invalid geometry: %+v", bad)
		}
	}
	if !validFrame(frame) {
		t.Fatal("rejected valid viewport geometry")
	}
	frame.X = -120 // partially scrolled native view must clip, rather than disappear.
	if !validFrame(frame) {
		t.Fatal("rejected partially visible player")
	}
}
