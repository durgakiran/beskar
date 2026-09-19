package editor

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

func checkpointPayload(update []byte) []byte {
	b, _ := json.Marshal(whiteboardCheckpointV2Body{UpdateEncoding: whiteboardUpdateEncodingV1, Update: base64.StdEncoding.EncodeToString(update)})
	return b
}
func TestWhiteboardYjsV1Fixtures(t *testing.T) {
	data, err := os.ReadFile("testdata/whiteboard-yjs-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Fixtures []struct{ Name, Update string }
	}
	if err = json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	for _, f := range file.Fixtures {
		t.Run(f.Name, func(t *testing.T) {
			update, err := base64.StdEncoding.DecodeString(f.Update)
			if err != nil {
				t.Fatal(err)
			}
			if _, _, err = validateWhiteboardCheckpointV2(checkpointPayload(update)); err != nil {
				t.Fatal(err)
			}
			if err = validateYjsUpdateV1(append(append([]byte(nil), update...), 0)); err == nil {
				t.Fatal("accepted trailing bytes")
			}
			if err = validateYjsUpdateV1(update[:len(update)-1]); err == nil {
				t.Fatal("accepted truncated update")
			}
		})
	}
}
func TestWhiteboardCheckpointValidation(t *testing.T) {
	for _, body := range [][]byte{
		[]byte("null"), []byte("{}"), []byte("[]"), []byte("{"), []byte{255},
		[]byte(`{"updateEncoding":"yjs-update-v2","update":"AAA="}`),
		[]byte(`{"updateEncoding":"yjs-update-v1","update":"invalid"}`),
		[]byte(`{"updateEncoding":"yjs-update-v1","update":"AAA=","unknown":true}`),
		append(checkpointPayload([]byte{0, 0}), []byte("{}")...),
		checkpointPayload([]byte{0}), checkpointPayload([]byte{255, 255, 255, 255, 255, 255, 255, 255}),
	} {
		if _, _, err := validateWhiteboardCheckpointV2(body); err == nil {
			t.Fatalf("accepted %q", body)
		}
	}
	if _, _, err := validateWhiteboardCheckpointV2(checkpointPayload(make([]byte, whiteboardCheckpointV2MaxUpdate+1))); !errors.Is(err, errWhiteboardV2UpdateTooLarge) {
		t.Fatal(err)
	}
	// A nested lib0 array cannot exhaust the Go stack.
	nested := []byte{1, 1, 1, 0, 8, 1, 1, 'm', 1}
	for i := 0; i < 66; i++ {
		nested = append(nested, 117, 1)
	}
	nested = append(nested, 126, 0)
	if validateYjsUpdateV1(nested) == nil {
		t.Fatal("accepted excessive nesting")
	}
	in := whiteboardCheckpointV2Input{UpdateEncoding: whiteboardUpdateEncodingV1, UpdateBytes: []byte{0, 0}}
	hash := whiteboardCheckpointV2Hash(in)
	in.UpdateBytes = []byte{0, 1}
	if hash == whiteboardCheckpointV2Hash(in) {
		t.Fatal("hash ignores bytes")
	}
	in.UpdateBytes = []byte{0, 0}
	in.UpdateEncoding = "different"
	if hash == whiteboardCheckpointV2Hash(in) {
		t.Fatal("hash ignores encoding")
	}
	// JSON/base64 representation differences do not change stored bytes.
	_, u, err := validateWhiteboardCheckpointV2([]byte("{\"updateEncoding\":\"yjs-update-v1\",\"update\":\"AA\\nA=\"}"))
	if err != nil || !bytes.Equal(u, []byte{0, 0}) {
		t.Fatal(err)
	}
}
func FuzzValidateYjsUpdateV1(f *testing.F) {
	f.Add([]byte{0, 0})
	f.Add([]byte{1, 1, 1, 0, 8, 1, 1, 'm', 1, 126, 0})
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) <= whiteboardCheckpointV2MaxUpdate {
			_ = validateYjsUpdateV1(data)
		}
	})
}

func TestCheckpointExactDecodedLimit(t *testing.T) {
	// A Yjs ContentBinary item: client 1, clock 0, root "m", then its byte length.
	prefix := []byte{1, 1, 1, 0, 3, 1, 1, 'm'}
	payloadLen := whiteboardCheckpointV2MaxUpdate - len(prefix) - 3 - 1
	update := binary.AppendUvarint(prefix, uint64(payloadLen))
	update = append(update, make([]byte, payloadLen)...)
	update = append(update, 0) // empty delete set
	if len(update) != whiteboardCheckpointV2MaxUpdate {
		t.Fatal(len(update))
	}
	body := checkpointPayload(update)
	if len(body) > whiteboardCheckpointV2MaxBody {
		t.Fatal("valid maximum cannot fit in HTTP limit")
	}
	if _, _, err := validateWhiteboardCheckpointV2(body); err != nil {
		t.Fatal(err)
	}
}
