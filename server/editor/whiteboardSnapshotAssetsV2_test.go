package editor

import (
	"context"
	"encoding/base64"
	"errors"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestMaterializeWhiteboardAssetContract(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is required for the pinned Yjs runtime")
	}
	runtime, err := filepath.Abs("../whiteboard-runtime")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("WHITEBOARD_YJS_RUNTIME_DIR", runtime)
	full, err := materializeWhiteboard(context.Background(), [][]byte{{0, 0}}, "Empty")
	if err != nil || full.AssetExtractorVersion != whiteboardAssetExtractorVersion || full.Assets == nil || len(full.Assets) != 0 {
		t.Fatalf("empty inspection is not explicit: %+v %v", full, err)
	}
	for _, tc := range []struct {
		name, statement string
		want            error
	}{
		{"raster", `const hash='a'.repeat(64), id='asset:sha256:'+hash; d.getMap('glideboard-records-v2').set(id,new Y.Map(Object.entries({id,kind:'asset',type:'raster-image',schemaVersion:1,props:{hash,mimeType:'image/png',byteLength:100,width:20,height:10},meta:{}})));`, nil},
		{"unsupported", `d.getMap('glideboard-records-v2').set('asset:1',new Y.Map(Object.entries({id:'asset:1',kind:'asset',type:'future-asset'})));`, errWhiteboardSnapshotAssetInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cmd := exec.Command("node", "--input-type=module", "-e", `import * as Y from 'yjs'; const d=new Y.Doc(); `+tc.statement+` process.stdout.write(Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64'));`)
			cmd.Dir = runtime
			encoded, err := cmd.Output()
			if err != nil {
				t.Fatal(err)
			}
			state, err := base64.StdEncoding.DecodeString(string(encoded))
			if err != nil {
				t.Fatal(err)
			}
			result, err := materializeWhiteboard(context.Background(), [][]byte{state}, "Raster")
			if !errors.Is(err, tc.want) {
				t.Fatalf("materializer failure mapping: got %v want %v", err, tc.want)
			}
			if tc.want == nil && (len(result.Assets) != 1 || result.Assets[0].MimeType != "image/png" || result.Assets[0].ByteLength != 100 || result.Assets[0].Width != 20 || result.Assets[0].Height != 10) {
				t.Fatalf("materialized metadata: %+v", result)
			}
		})
	}
}
