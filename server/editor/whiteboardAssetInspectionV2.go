package editor

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/webp"
)

// Bound full image decoding independently of the number of HTTP requests.
var whiteboardAssetDecodeSlots = make(chan struct{}, 2)

func inspectWhiteboardAssetV2(ctx context.Context, data []byte, contentType string) (whiteboardAssetDescriptor, error) {
	var out whiteboardAssetDescriptor
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if !whiteboardAssetSupportedType(contentType) {
		return out, errWhiteboardAssetUnsupported
	}
	if len(data) == 0 {
		return out, errWhiteboardAssetInvalid
	}
	if len(data) > whiteboardAssetMaxBytes {
		return out, errWhiteboardAssetTooLarge
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return out, fmt.Errorf("%w: unreadable image header", errWhiteboardAssetInvalid)
	}
	actualType := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}[format]
	if actualType == "" {
		return out, errWhiteboardAssetUnsupported
	}
	if contentType != actualType {
		return out, fmt.Errorf("%w: MIME does not match image", errWhiteboardAssetInvalid)
	}
	if config.Width < 1 || config.Height < 1 || config.Width > 16384 || config.Height > 16384 || int64(config.Width)*int64(config.Height) > 64_000_000 {
		return out, errWhiteboardAssetTooLarge
	}
	select {
	case whiteboardAssetDecodeSlots <- struct{}{}:
		defer func() { <-whiteboardAssetDecodeSlots }()
	case <-ctx.Done():
		return out, ctx.Err()
	}
	decoded, decodedFormat, err := image.Decode(bytes.NewReader(data))
	if err != nil || decodedFormat != format {
		return out, fmt.Errorf("%w: image cannot be fully decoded", errWhiteboardAssetInvalid)
	}
	if decoded.Bounds().Dx() != config.Width || decoded.Bounds().Dy() != config.Height {
		return out, errWhiteboardAssetInvalid
	}
	if err = ctx.Err(); err != nil {
		return out, err
	}
	out.ContentHash = fmt.Sprintf("%x", sha256.Sum256(data))
	out.ContentType, out.ByteLength, out.Width, out.Height = actualType, int64(len(data)), config.Width, config.Height
	return out, nil
}
