package storage

import "path"

func AttachmentObjectKey(name string) string {
	return path.Join("attachments", name)
}

func ImageObjectKey(name string) string {
	return path.Join("images", name)
}
