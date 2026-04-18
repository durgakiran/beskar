package core

import "testing"

func TestNormalizeAttachmentStoragePath(t *testing.T) {
	t.Setenv("UPLOAD_STORAGE_DIR", "/var/lib/beskar/uploads")

	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "new relative path", input: "attachments/file.pdf", want: "attachments/file.pdf"},
		{name: "legacy public path", input: "public/attachments/file.pdf", want: "attachments/file.pdf"},
		{name: "current root prefixed path", input: "/var/lib/beskar/uploads/attachments/file.pdf", want: "attachments/file.pdf"},
		{name: "invalid traversal", input: "../attachments/file.pdf", wantErr: true},
		{name: "wrong prefix", input: "images/file.png", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeAttachmentStoragePath(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got path %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}
