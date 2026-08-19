package media

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

func testPNG(t *testing.T) []byte {
	t.Helper()
	var output bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 16, 8))
	picture.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&output, picture); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func hashBytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func TestInspectWhiteboardRasterAcceptsBoundedPNG(t *testing.T) {
	data := testPNG(t)
	inspected, err := InspectWhiteboardRaster(data, "image/png", hashBytes(data))
	if err != nil {
		t.Fatal(err)
	}
	if inspected.MimeType != "image/png" || inspected.Width != 16 || inspected.Height != 8 {
		t.Fatalf("unexpected inspection result: %#v", inspected)
	}
}

func TestInspectWhiteboardRasterRejectsMismatchAndActiveFormats(t *testing.T) {
	data := testPNG(t)
	cases := []struct {
		name string
		data []byte
		mime string
		hash string
	}{
		{name: "MIME mismatch", data: data, mime: "image/jpeg", hash: hashBytes(data)},
		{name: "hash mismatch", data: data, mime: "image/png", hash: string(make([]byte, 64))},
		{name: "SVG active document", data: []byte(`<svg><script>alert(1)</script></svg>`), mime: "image/svg+xml", hash: hashBytes([]byte(`<svg><script>alert(1)</script></svg>`))},
		{name: "remote URL text", data: []byte(`https://127.0.0.1/private`), mime: "text/plain", hash: hashBytes([]byte(`https://127.0.0.1/private`))},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if _, err := InspectWhiteboardRaster(test.data, test.mime, test.hash); err == nil {
				t.Fatal("expected inspection failure")
			}
		})
	}
}

func TestWhiteboardRasterDimensionLimits(t *testing.T) {
	if err := validateWhiteboardRasterDimensions(16_384, 16_384); err == nil {
		t.Fatal("expected decompression-bomb pixel limit failure")
	}
	if err := validateWhiteboardRasterDimensions(8_000, 8_000); err != nil {
		t.Fatalf("expected maximum supported pixel count to pass: %v", err)
	}
	if err := validateWhiteboardRasterDimensions(16_385, 1); err == nil {
		t.Fatal("expected dimension limit failure")
	}
}

func TestWhiteboardAssetObjectIdentityIsLowercaseSHA256(t *testing.T) {
	data := testPNG(t)
	hash := hashBytes(data)
	if !validContentHash(hash) {
		t.Fatalf("expected valid content hash: %s", hash)
	}
	if validContentHash(strings.ToUpper(hash)) {
		t.Fatal("uppercase hashes must not create a second identity")
	}
}
