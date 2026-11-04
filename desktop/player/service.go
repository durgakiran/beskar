// Package player hosts credential-free inline media views. It never receives
// an auth manager, API capability, arbitrary URL, or browser-provided identity.
package player

import (
	"context"
	"fmt"
	"math"
	"regexp"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type Frame struct {
	X              float64 `json:"x"`
	Y              float64 `json:"y"`
	Width          float64 `json:"width"`
	Height         float64 `json:"height"`
	ClipX          float64 `json:"clipX"`
	ClipY          float64 `json:"clipY"`
	ClipWidth      float64 `json:"clipWidth"`
	ClipHeight     float64 `json:"clipHeight"`
	ViewportWidth  float64 `json:"viewportWidth"`
	ViewportHeight float64 `json:"viewportHeight"`
}

type Service struct{}

func New() *Service              { return &Service{} }
func (*Service) Supported() bool { return supported }

var playerID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
var videoID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

func validFrame(f Frame) bool {
	for _, v := range []float64{f.X, f.Y, f.Width, f.Height, f.ClipX, f.ClipY, f.ClipWidth, f.ClipHeight, f.ViewportWidth, f.ViewportHeight} {
		if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 100000 {
			return false
		}
	}
	return f.Width > 0 && f.Width <= 8192 && f.Height > 0 && f.Height <= 8192 && f.ClipWidth >= 0 && f.ClipHeight >= 0 && f.ViewportWidth > 0 && f.ViewportHeight > 0
}
func (*Service) Show(ctx context.Context, id, video string, frame Frame) error {
	if !supported || !playerID.MatchString(id) || !videoID.MatchString(video) || !validFrame(frame) {
		return fmt.Errorf("invalid inline player request")
	}
	return withWindow(ctx, func(w *application.WebviewWindow) bool { return show(w.NativeWindow(), id, video, frame) })
}
func (*Service) Hide(ctx context.Context, id string) error {
	if !playerID.MatchString(id) {
		return fmt.Errorf("invalid player identifier")
	}
	return withWindow(ctx, func(w *application.WebviewWindow) bool { hide(w.NativeWindow(), id, false); return true })
}
func (*Service) Close(ctx context.Context, id string) error {
	if !playerID.MatchString(id) {
		return fmt.Errorf("invalid player identifier")
	}
	return withWindow(ctx, func(w *application.WebviewWindow) bool { hide(w.NativeWindow(), id, true); return true })
}
func withWindow(ctx context.Context, action func(*application.WebviewWindow) bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	app := application.Get()
	if app == nil {
		return fmt.Errorf("application unavailable")
	}
	ok := false
	application.InvokeSync(func() {
		if ctx.Err() != nil {
			return
		}
		windows := app.Window.GetAll()
		if len(windows) > 0 {
			if window, valid := windows[0].(*application.WebviewWindow); valid {
				ok = action(window)
			}
		}
	})
	if !ok {
		return fmt.Errorf("inline player unavailable")
	}
	return nil
}
