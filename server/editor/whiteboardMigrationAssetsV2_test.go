package editor

import (
	"errors"
	"strings"
	"testing"
)

func TestMigrationAssetManifestsPreserveAllCanonicalAssets(t *testing.T) {
	hash := strings.Repeat("a", 64)
	asset := whiteboardSnapshotAsset{ContentHash: hash, MimeType: "image/png", ByteLength: 100, Width: 3, Height: 2}
	source := whiteboardMigrationInspection{Assets: []whiteboardSnapshotAsset{asset}, AssetIDs: []string{"asset:sha256:" + hash}, AssetExtractorVersion: whiteboardAssetExtractorVersion}
	for _, tc := range []struct {
		name   string
		change func(*whiteboardMigrationInspection)
		want   error
	}{
		{"identical", func(*whiteboardMigrationInspection) {}, nil},
		{"strip raster", func(v *whiteboardMigrationInspection) {
			v.Assets = []whiteboardSnapshotAsset{}
			v.AssetIDs = []string{}
		}, errWhiteboardMigrationAssetMismatch},
		{"mutate raster dimensions", func(v *whiteboardMigrationInspection) { v.Assets[0].Width++ }, errWhiteboardMigrationAssetMismatch},
		{"mutate raster bytes", func(v *whiteboardMigrationInspection) { v.Assets[0].ByteLength++ }, errWhiteboardMigrationAssetMismatch},
		{"add vector identity", func(v *whiteboardMigrationInspection) {
			v.AssetIDs = append(v.AssetIDs, "asset:sha256:"+strings.Repeat("b", 64))
		}, errWhiteboardMigrationAssetMismatch},
		{"omit raster identity", func(v *whiteboardMigrationInspection) { v.AssetIDs = []string{} }, errWhiteboardMigrationFormat},
	} {
		t.Run(tc.name, func(t *testing.T) {
			submitted := source
			submitted.Assets = append([]whiteboardSnapshotAsset{}, source.Assets...)
			submitted.AssetIDs = append([]string{}, source.AssetIDs...)
			tc.change(&submitted)
			if err := validateMigrationAssetManifests(source, submitted); !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
		})
	}
	vectorSource := whiteboardMigrationInspection{Assets: []whiteboardSnapshotAsset{}, AssetIDs: []string{"asset:sha256:" + hash}, AssetExtractorVersion: whiteboardAssetExtractorVersion}
	empty := whiteboardMigrationInspection{Assets: []whiteboardSnapshotAsset{}, AssetIDs: []string{}, AssetExtractorVersion: whiteboardAssetExtractorVersion}
	if !errors.Is(validateMigrationAssetManifests(vectorSource, empty), errWhiteboardMigrationAssetMismatch) {
		t.Fatal("stripped vector accepted")
	}
}
