package services

import (
	"os"
	"strconv"
	"strings"
)

// AllowedMimeTypes — explicit application/* types that are commonly safe/useful as attachments.
var AllowedMimeTypes = map[string]bool{
	"application/pdf": true,
	"application/json": true,
	"application/zip": true,
	"application/x-zip-compressed": true,
	"application/x-7z-compressed": true,
	"application/vnd.rar": true,
	"application/gzip": true,
	"application/x-tar": true,
	"application/msword": true,
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
	"application/vnd.ms-excel": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"application/vnd.ms-powerpoint": true,
	"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
	"application/xml": true,
}

// AllowedMimePrefixes — broader safe categories we accept by default.
var AllowedMimePrefixes = []string{
	"text/",
	"image/",
	"audio/",
	"video/",
}

// DeniedMimeTypes — executables and obvious script delivery types.
var DeniedMimeTypes = map[string]bool{
	"application/x-msdownload":    true,
	"application/x-executable":    true,
	"application/x-sh":            true,
	"application/x-bat":           true,
	"application/x-msdos-program": true,
}

const defaultMaxAttachmentBytes = 10 * 1024 * 1024 // 10 MiB

// MaxAttachmentBytes is resolved once at process start (override with ATTACHMENT_MAX_BYTES).
var MaxAttachmentBytes = defaultMaxAttachmentBytes

func init() {
	if v := os.Getenv("ATTACHMENT_MAX_BYTES"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			MaxAttachmentBytes = int(n)
		}
	}
}

// MimeAllowed returns false if type is denied or not in the allowlist.
func MimeAllowed(mime string) bool {
	if mime == "" {
		return false
	}
	if DeniedMimeTypes[mime] {
		return false
	}
	if AllowedMimeTypes[mime] {
		return true
	}
	for _, prefix := range AllowedMimePrefixes {
		if strings.HasPrefix(mime, prefix) {
			return true
		}
	}
	return false
}
