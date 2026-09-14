package editor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const whiteboardPublishMaxBytes = 32 * 1024 * 1024

// A pinned Yjs runtime reconstructs CRDT semantics instead of approximating
// them in the wire validator. A separate process bounds heap and execution time.
func materializeWhiteboard(ctx context.Context, updates [][]byte, title string) (whiteboardMaterialized, error) {
	var result whiteboardMaterialized
	input, err := json.Marshal(struct {
		Updates [][]byte `json:"updates"`
		Title   string   `json:"title"`
	}{updates, title})
	if err != nil {
		return result, err
	}
	runtimeDir := os.Getenv("WHITEBOARD_YJS_RUNTIME_DIR")
	if runtimeDir == "" {
		runtimeDir = "whiteboard-runtime"
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "--max-old-space-size=256", filepath.Join(runtimeDir, "materialize.mjs"))
	cmd.Stdin = bytes.NewReader(input)
	output := &whiteboardLimitedBuffer{limit: 48 * 1024 * 1024}
	cmd.Stdout = output
	if err = cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 2 {
			return result, errWhiteboardPublishState
		}
		return result, err
	}
	if err = json.Unmarshal(output.Bytes(), &result); err != nil {
		return result, err
	}
	if len(result.State) > whiteboardPublishMaxBytes {
		return result, errWhiteboardPublishLimit
	}
	if validateYjsUpdateV1(result.State) != nil {
		return result, errWhiteboardPublishState
	}
	return result, nil
}

type whiteboardLimitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *whiteboardLimitedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, errWhiteboardPublishLimit
	}
	return b.Buffer.Write(p)
}
