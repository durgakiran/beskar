package storage

import "testing"

func TestS3StoreObjectKey(t *testing.T) {
	store := &S3Store{prefix: "beskar-dev/uploads"}
	if got := store.objectKey("attachments/file.pdf"); got != "beskar-dev/uploads/attachments/file.pdf" {
		t.Fatalf("got %q", got)
	}
}

func TestS3StoreObjectKeyNoPrefix(t *testing.T) {
	store := &S3Store{}
	if got := store.objectKey("attachments/file.pdf"); got != "attachments/file.pdf" {
		t.Fatalf("got %q", got)
	}
}
