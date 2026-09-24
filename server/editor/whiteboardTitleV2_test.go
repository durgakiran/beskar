package editor

import (
	"bytes"
	"context"
	"errors"
	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWhiteboardTitleValidation(t *testing.T) {
	for _, raw := range []string{`{"title":null}`, `{"title":42}`, `{"title":" "}`, `{"title":"a\u0000b"}`, `{"title":"` + strings.Repeat("a", 256) + `"}`} {
		if _, err := parseWhiteboardTitle([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
	title, err := parseWhiteboardTitle([]byte(`{"title":"  Diagram 🌍  "}`))
	if err != nil || title == nil || *title != "Diagram 🌍" {
		t.Fatal("normalization failed")
	}
	if title, err := parseWhiteboardTitle([]byte(`{}`)); err != nil || title != nil {
		t.Fatal("omission must preserve title")
	}
}
func TestCheckpointTitleAtomicityAndRetry(t *testing.T) {
	title := "Renamed"
	in := checkpointTestInput()
	original := whiteboardCheckpointV2Hash(in)
	in.Title = &title
	if original == whiteboardCheckpointV2Hash(in) {
		t.Fatal("title excluded from hash")
	}
	tx := newCheckpointTestTx(in)
	result, err := checkpointService(tx).CheckpointWhiteboard(context.Background(), in)
	if err != nil || !tx.committed {
		t.Fatal(err)
	}
	args := tx.writes[whiteboardV2InsertTitle]
	if len(args) != 3 || args[0] != in.PageID || args[1] != result.Sequence || args[2] != title {
		t.Fatal("title not tied to checkpoint")
	}
	tx = newCheckpointTestTx(in)
	tx.hash = whiteboardCheckpointV2Hash(in)
	if _, err = checkpointService(tx).CheckpointWhiteboard(context.Background(), in); err != nil || len(tx.writes) != 0 {
		t.Fatal("retry rewrote title")
	}
	changed := "Other"
	in.Title = &changed
	if _, err = checkpointService(tx).CheckpointWhiteboard(context.Background(), in); !errors.Is(err, errWhiteboardV2KeyReuse) {
		t.Fatal("title key reuse accepted")
	}
	tx = newCheckpointTestTx(in)
	tx.fail = whiteboardV2InsertTitle
	tx.cause = errors.New("failure")
	if _, err = checkpointService(tx).CheckpointWhiteboard(context.Background(), in); err == nil || tx.committed {
		t.Fatal("title failure committed checkpoint")
	}
}

func TestCheckpointTitleHTTP(t *testing.T) {
	actor, space, key := uuid.New(), uuid.New(), uuid.New()
	deps := whiteboardCheckpointControllerV2{user: func(context.Context) (core.UserInfo, error) {
		return core.UserInfo{Id: "user", AId: actor.String()}, nil
	}, canEdit: func(_ string, _ uuid.UUID, p string) bool { return p == "edit" }, service: checkpointFunc(func(_ context.Context, in whiteboardCheckpointV2Input) (whiteboardCheckpointV2Result, error) {
		if in.Title == nil || *in.Title != "Renamed" || !bytes.Equal(in.UpdateBytes, []byte{0, 0}) || in.IdempotencyKey != key {
			t.Fatal("wrong rename input")
		}
		return whiteboardCheckpointV2Result{PageID: 42, Sequence: 1, UpdateID: uuid.New()}, nil
	})}
	router := chi.NewRouter()
	router.Post("/space/{spaceId}/whiteboard/{pageId}/checkpoint", deps.handleCheckpoint)
	req := httptest.NewRequest("POST", "/space/"+space.String()+"/whiteboard/42/checkpoint", strings.NewReader(`{"updateEncoding":"yjs-update-v1","update":"AAA=","title":"  Renamed  "}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key.String())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("rename: %d %s", w.Code, w.Body.String())
	}
}
