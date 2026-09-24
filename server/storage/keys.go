package storage

import (
	"fmt"
	"path"
)

func AttachmentObjectKey(name string) string {
	return path.Join("attachments", name)
}

func ImageObjectKey(name string) string {
	return path.Join("images", name)
}

func WhiteboardAssetObjectKey(pageID int64, hash string) string {
	return path.Join("whiteboard-assets", fmt.Sprintf("%d", pageID), "sha256", hash)
}
