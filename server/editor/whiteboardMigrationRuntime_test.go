package editor

import (
	"context"
	"encoding/base64"
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectWhiteboardMigrationAssetContract(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is required for the pinned Yjs runtime")
	}
	runtime, err := filepath.Abs("../whiteboard-runtime")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("WHITEBOARD_YJS_RUNTIME_DIR", runtime)
	const setup = `import * as Y from 'yjs'; import {createHash} from 'node:crypto'; const d=new Y.Doc();
const put=(record,root='glideboard-records-v2')=>d.getMap(root).set(record.id,root.endsWith('-v2')?new Y.Map(Object.entries(record)):record);
const raster=(hash='a'.repeat(64))=>({id:'asset:sha256:'+hash,kind:'asset',type:'raster-image',schemaVersion:1,props:{hash,mimeType:'image/png',byteLength:100,width:20,height:10},meta:{}});
`
	for _, tc := range []struct {
		name, statement, identity string
		wantRasters, wantIDs      int
		want                      error
	}{
		{name: "explicit empty manifest"},
		{name: "canonical raster", statement: `put(raster());`, wantRasters: 1, wantIDs: 1},
		{name: "manifest exceeds former small output buffer", statement: `for(let n=0;n<120;n++)put(raster(n.toString(16).padStart(64,'0')));`, wantRasters: 120, wantIDs: 120},
		{name: "flat legacy inferred raster shape", statement: `const asset=raster();put(asset,'glideboard-records');put({id:'shape:old',type:'raster-image',x:0,y:0,rotation:0,index:'a1',props:{assetId:asset.id,w:20,h:10}},'glideboard-records');`, wantRasters: 1, wantIDs: 1},
		{name: "self-contained vector identity", statement: `const canonical={viewBox:[0,0,10,20],width:10,height:20,paths:[{d:'M 0 0 L 10 20',stroke:'#fff'}]};const content=JSON.stringify(canonical),hash=createHash('sha256').update(content).digest('hex');put({id:'asset:sha256:'+hash,kind:'asset',type:'sanitized-svg',schemaVersion:1,props:{hash,mimeType:'image/svg+xml',sanitizerVersion:1,byteLength:Buffer.byteLength(content),...canonical},meta:{}});`, wantIDs: 1},
		{name: "exact target identity", statement: `d.getMap('glideboard-meta').set('boardIdentity','v2:s:42');put(raster());`, identity: "v2:s:42", wantRasters: 1, wantIDs: 1},
		{name: "wrong target identity", statement: `d.getMap('glideboard-meta').set('boardIdentity','v2:s:41');`, identity: "v2:s:42", want: errWhiteboardMigrationFormat},
		{name: "unsupported asset", statement: `put({id:'asset:unknown',kind:'asset',type:'future-asset'});`, want: errWhiteboardMigrationAssets},
		{name: "opaque record", statement: `put({id:'shape:1',kind:'opaque',type:'future-shape'});`, want: errWhiteboardMigrationAssets},
		{name: "unknown document root", statement: `d.getMap('unknown').set('asset',raster());`, want: errWhiteboardMigrationFormat},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cmd := exec.Command("node", "--input-type=module", "-e", setup+tc.statement+`process.stdout.write(Buffer.from(Y.encodeStateAsUpdate(d)).toString('base64'));`)
			cmd.Dir = runtime
			encoded, err := cmd.Output()
			if err != nil {
				t.Fatal(err)
			}
			state, err := base64.StdEncoding.DecodeString(string(encoded))
			if err != nil {
				t.Fatal(err)
			}
			result, err := inspectWhiteboardMigration(context.Background(), state, tc.identity)
			if !errors.Is(err, tc.want) {
				t.Fatalf("inspection failure mapping: got %v want %v", err, tc.want)
			}
			if tc.want != nil {
				return
			}
			if result.AssetExtractorVersion != whiteboardAssetExtractorVersion || result.Assets == nil || result.AssetIDs == nil || len(result.Assets) != tc.wantRasters || len(result.AssetIDs) != tc.wantIDs {
				t.Fatalf("unexpected canonical manifest: %+v", result)
			}
			for _, asset := range result.Assets {
				if asset.MimeType != "image/png" || asset.ByteLength != 100 || asset.Width != 20 || asset.Height != 10 {
					t.Fatalf("unexpected raster descriptor: %+v", asset)
				}
			}
		})
	}
}

func TestWhiteboardMigrationManifestRequiresCompleteCanonicalIDs(t *testing.T) {
	hash := strings.Repeat("a", 64)
	asset := whiteboardSnapshotAsset{ContentHash: hash, MimeType: "image/png", ByteLength: 100, Width: 20, Height: 10}
	for _, tc := range []struct {
		name string
		ids  []string
	}{
		{"missing manifest", nil},
		{"stripped raster identity", []string{}},
		{"wrong asset identity", []string{"asset:sha256:" + strings.Repeat("b", 64)}},
		{"noncanonical identity", []string{"asset:" + hash}},
		{"duplicate identity", []string{"asset:sha256:" + hash, "asset:sha256:" + hash}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := whiteboardMigrationInspection{Assets: []whiteboardSnapshotAsset{asset}, AssetIDs: tc.ids, AssetExtractorVersion: whiteboardAssetExtractorVersion}
			if !errors.Is(validateWhiteboardMigrationInspection(result), errWhiteboardMigrationFormat) {
				t.Fatal("incomplete canonical asset manifest was accepted")
			}
		})
	}
}
