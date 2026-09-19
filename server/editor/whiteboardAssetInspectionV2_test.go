package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"testing"
)

func assetInspectionPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 7, 5))
	img.Set(2, 3, color.NRGBA{R: 200, G: 50, B: 100, A: 255})
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestWhiteboardAssetInspectionV2(t *testing.T) {
	pngBytes := assetInspectionPNG(t)
	var jpegBytes bytes.Buffer
	if err := jpeg.Encode(&jpegBytes, image.NewRGBA(image.Rect(0, 0, 7, 5)), nil); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, mime string
		data       []byte
	}{
		{"PNG", "image/png", pngBytes}, {"JPEG", "image/jpeg", jpegBytes.Bytes()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := inspectWhiteboardAssetV2(context.Background(), tc.data, tc.mime)
			if err != nil {
				t.Fatal(err)
			}
			if got.ContentHash != fmt.Sprintf("%x", sha256.Sum256(tc.data)) || got.Width != 7 || got.Height != 5 || got.ByteLength != int64(len(tc.data)) || got.ContentType != tc.mime {
				t.Fatalf("metadata: %+v", got)
			}
			// A valid header is not enough: incomplete compressed pixels fail.
			truncated := tc.data[:len(tc.data)-15]
			if _, _, err = image.DecodeConfig(bytes.NewReader(truncated)); err != nil {
				t.Fatalf("fixture lost its header: %v", err)
			}
			if _, err = inspectWhiteboardAssetV2(context.Background(), truncated, tc.mime); !errors.Is(err, errWhiteboardAssetInvalid) {
				t.Fatalf("truncated image accepted: %v", err)
			}
		})
	}
	for _, name := range []string{"blue-purple-pink.lossy.webp", "blue-purple-pink.lossless.webp", "yellow_rose.lossy-with-alpha.webp"} {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile("testdata/asset-webp/" + name)
			if err != nil {
				t.Fatal(err)
			}
			got, err := inspectWhiteboardAssetV2(context.Background(), data, "image/webp")
			if err != nil || got.Width < 1 || got.Height < 1 || got.ContentHash != fmt.Sprintf("%x", sha256.Sum256(data)) {
				t.Fatalf("WebP decode: %+v %v", got, err)
			}
			if _, err = inspectWhiteboardAssetV2(context.Background(), data[:len(data)/2], "image/webp"); !errors.Is(err, errWhiteboardAssetInvalid) {
				t.Fatalf("truncated WebP: %v", err)
			}
		})
	}
	for _, tc := range []struct {
		name, mime string
		data       []byte
		want       error
	}{
		{"empty", "image/png", nil, errWhiteboardAssetInvalid},
		{"mismatched MIME", "image/jpeg", pngBytes, errWhiteboardAssetInvalid},
		{"unsupported MIME", "image/svg+xml", pngBytes, errWhiteboardAssetUnsupported},
		{"text pretending PNG", "image/png", []byte("not an image"), errWhiteboardAssetInvalid},
		{"encoded limit", "image/png", make([]byte, whiteboardAssetMaxBytes+1), errWhiteboardAssetTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := inspectWhiteboardAssetV2(context.Background(), tc.data, tc.mime); !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
		})
	}
}

func TestWhiteboardAssetInspectionRejectsDimensionsBeforeFullDecode(t *testing.T) {
	for _, size := range [][2]uint32{{16385, 1}, {1, 16385}, {8001, 8000}} {
		data := append([]byte(nil), assetInspectionPNG(t)...)
		binary.BigEndian.PutUint32(data[16:20], size[0])
		binary.BigEndian.PutUint32(data[20:24], size[1])
		binary.BigEndian.PutUint32(data[29:33], crc32.ChecksumIEEE(data[12:29]))
		if _, err := inspectWhiteboardAssetV2(context.Background(), data, "image/png"); !errors.Is(err, errWhiteboardAssetTooLarge) {
			t.Fatalf("dimensions %v: %v", size, err)
		}
	}
}

func TestWhiteboardAssetInspectionCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := inspectWhiteboardAssetV2(ctx, assetInspectionPNG(t), "image/png"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel: %v", err)
	}
	whiteboardAssetDecodeSlots <- struct{}{}
	whiteboardAssetDecodeSlots <- struct{}{}
	defer func() { <-whiteboardAssetDecodeSlots; <-whiteboardAssetDecodeSlots }()
	ctx, cancel = context.WithCancel(context.Background())
	done := make(chan error, 1)
	data := assetInspectionPNG(t)
	go func() { _, err := inspectWhiteboardAssetV2(ctx, data, "image/png"); done <- err }()
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("queued decode cancel: %v", err)
	}
}
