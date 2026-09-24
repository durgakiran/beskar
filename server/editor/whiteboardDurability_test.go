package editor

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestValidateWhiteboardCheckpointVerifiesDecodedPayloadDigest(t *testing.T) {
	data := []byte{1, 2, 3, 4}
	digest := fmt.Sprintf("sha256:%x", sha256.Sum256(data))
	payload, err := json.Marshal(map[string]interface{}{
		"draftId":             42,
		"data":                data,
		"transactionSequence": 7,
		"stateDigest":         digest,
		"expectedRevision":    "3",
		"clientId":            "client-1",
		"requestId":           "request-1",
	})
	if err != nil {
		t.Fatal(err)
	}

	checkpoint, err := ValidateWhiteboardCheckpoint(payload)
	if err != nil {
		t.Fatalf("expected valid checkpoint: %v", err)
	}
	if string(checkpoint.Data) != string(data) {
		t.Fatalf("decoded data mismatch: got %v", checkpoint.Data)
	}

	checkpoint.StateDigest = "sha256:wrong"
	payload, err = json.Marshal(checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateWhiteboardCheckpoint(payload); err == nil {
		t.Fatal("expected mismatched digest to be rejected")
	}
}

func TestWhiteboardCheckpointRequestHashBindsCanonicalFieldsAndBytes(t *testing.T) {
	base := WhiteboardCheckpointInput{
		DraftId:             42,
		Data:                []byte{1, 2, 3},
		TransactionSequence: 7,
		StateDigest:         "sha256:digest",
		ExpectedRevision:    "3",
		ClientId:            "client-1",
		RequestId:           "request-1",
		OwnerId:             uuid.New(),
	}
	original := hashWhiteboardCheckpointRequest(base)

	changed := base
	changed.Data = []byte{1, 2, 4}
	if hashWhiteboardCheckpointRequest(changed) == original {
		t.Fatal("request hash must change when decoded bytes change")
	}
	changed = base
	changed.ExpectedRevision = "4"
	if hashWhiteboardCheckpointRequest(changed) == original {
		t.Fatal("request hash must change when expected revision changes")
	}
}

func TestValidateWhiteboardPublishBindsPublishedBytesToCheckpoint(t *testing.T) {
	data := []byte{9, 8, 7}
	digest := fmt.Sprintf("sha256:%x", sha256.Sum256(data))
	payload, err := json.Marshal(map[string]interface{}{
		"draftId":               42,
		"data":                  data,
		"expectedDraftRevision": "3",
		"clientId":              "client-1",
		"requestId":             "publish-1",
		"checkpoint": map[string]interface{}{
			"transactionSequence":  7,
			"serverUpdateSequence": 3,
			"stateDigest":          digest,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	publish, err := ValidateWhiteboardPublish(payload)
	if err != nil {
		t.Fatalf("expected valid publish: %v", err)
	}
	publish.Data = []byte{9, 8, 6}
	payload, err = json.Marshal(publish)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ValidateWhiteboardPublish(payload); err == nil {
		t.Fatal("expected publish bytes that differ from the checkpoint digest to be rejected")
	}
}

func TestWhiteboardPublishRequestHashBindsRevisionAndPreview(t *testing.T) {
	base := WhiteboardPublishInput{
		Id:                    2,
		DraftId:               42,
		Data:                  []byte{1, 2, 3},
		PreviewAssetName:      "preview-a",
		ExpectedDraftRevision: "3",
		ClientId:              "client-1",
		Checkpoint: WhiteboardAcknowledgedCheckpoint{
			TransactionSequence:  7,
			ServerUpdateSequence: 3,
			StateDigest:          "sha256:digest",
		},
	}
	original := hashWhiteboardPublishRequest(base)
	changed := base
	changed.ExpectedDraftRevision = "4"
	if hashWhiteboardPublishRequest(changed) == original {
		t.Fatal("publish hash must bind the expected revision")
	}
	changed = base
	changed.PreviewAssetName = "preview-b"
	if hashWhiteboardPublishRequest(changed) == original {
		t.Fatal("publish hash must bind the preview asset")
	}
}
