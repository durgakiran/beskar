package editor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type whiteboardMigrationInspection struct {
	Assets                []whiteboardSnapshotAsset `json:"assets"`
	AssetIDs              []string                  `json:"assetIds"`
	AssetExtractorVersion string                    `json:"assetExtractorVersion"`
}

func validateWhiteboardMigrationInspection(result whiteboardMigrationInspection) error {
	if validateWhiteboardSnapshotAssets(whiteboardMaterialized{
		Assets: result.Assets, AssetExtractorVersion: result.AssetExtractorVersion,
	}) != nil || result.AssetIDs == nil || len(result.AssetIDs) > 10000 {
		return errWhiteboardMigrationFormat
	}
	ids := make(map[string]bool, len(result.AssetIDs))
	last := ""
	for _, id := range result.AssetIDs {
		if !strings.HasPrefix(id, "asset:sha256:") || !whiteboardSnapshotAssetHash.MatchString(strings.TrimPrefix(id, "asset:sha256:")) || id <= last {
			return errWhiteboardMigrationFormat
		}
		ids[id] = true
		last = id
	}
	for _, asset := range result.Assets {
		if !ids["asset:sha256:"+asset.ContentHash] {
			return errWhiteboardMigrationFormat
		}
	}
	return nil
}

func inspectWhiteboardMigration(ctx context.Context, state []byte, identity string) (whiteboardMigrationInspection, error) {
	var result whiteboardMigrationInspection
	if len(state) == 0 || len(state) > whiteboardPublishMaxBytes {
		return result, errWhiteboardPublishLimit
	}
	input, err := json.Marshal(struct {
		State    []byte `json:"state"`
		Identity string `json:"boardIdentity,omitempty"`
	}{state, identity})
	if err != nil {
		return result, err
	}
	dir := os.Getenv("WHITEBOARD_YJS_RUNTIME_DIR")
	if dir == "" {
		dir = "whiteboard-runtime"
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", "--max-old-space-size=256", filepath.Join(dir, "inspect-migration.mjs"))
	cmd.Stdin = bytes.NewReader(input)
	// Up to 10,000 canonical raster descriptors, bounded independently of state.
	output := &whiteboardLimitedBuffer{limit: 4 * 1024 * 1024}
	cmd.Stdout = output
	if err = cmd.Run(); err != nil {
		var code *exec.ExitError
		if errors.As(err, &code) {
			if code.ExitCode() == 3 {
				return result, errWhiteboardMigrationAssets
			}
			if code.ExitCode() == 2 {
				return result, errWhiteboardMigrationFormat
			}
		}
		return result, err
	}
	if json.Unmarshal(output.Bytes(), &result) != nil || validateWhiteboardMigrationInspection(result) != nil {
		return whiteboardMigrationInspection{}, errWhiteboardMigrationFormat
	}
	return result, nil
}
