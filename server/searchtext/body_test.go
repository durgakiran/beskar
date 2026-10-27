package searchtext

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func id(n int) uuid.UUID { return uuid.MustParse(fmt.Sprintf("00000000-0000-0000-0000-%012d", n)) }
func node(n, parent, order int, kind string) ContentNode {
	return ContentNode{ID: id(n), ParentID: id(parent), DocID: 7, Order: int64(order), Type: kind}
}
func text(parent, order int, value string) TextNode {
	return TextNode{ParentID: id(parent), DocID: 7, Order: int64(order), Text: value}
}
func paragraph() DocumentNodes {
	return DocumentNodes{DocID: 7, Content: []ContentNode{node(1, 0, 0, "doc"), node(2, 1, 0, "paragraph")}}
}

func TestExtractMixedInlineAndShuffledInput(t *testing.T) {
	input := paragraph()
	mention := node(3, 2, 1, "mention")
	mention.Attrs = map[string]any{"label": "Kiran", "id": "never-index-this-id"}
	br := node(4, 2, 3, "hardBreak")
	input.Content = append(input.Content, mention, br)
	input.Text = []TextNode{text(2, 0, "Hello "), text(2, 2, "!"), text(2, 4, "data"), text(2, 5, "base")}
	want := "Hello Kiran!\ndatabase"
	for seed := int64(0); seed < 30; seed++ {
		r := rand.New(rand.NewSource(seed))
		r.Shuffle(len(input.Content), func(i, j int) { input.Content[i], input.Content[j] = input.Content[j], input.Content[i] })
		r.Shuffle(len(input.Text), func(i, j int) { input.Text[i], input.Text[j] = input.Text[j], input.Text[i] })
		before, _ := json.Marshal(input)
		got, err := Extract(input)
		if err != nil || got != want {
			t.Fatalf("seed=%d got=%q err=%v", seed, got, err)
		}
		after, _ := json.Marshal(input)
		if string(before) != string(after) {
			t.Fatal("input mutated")
		}
	}
}

func TestExtractBlocksAndTables(t *testing.T) {
	input := DocumentNodes{DocID: 7, Content: []ContentNode{
		node(1, 0, 0, "doc"), node(2, 1, 0, "heading"), node(3, 1, 4, "bulletList"),
		node(4, 3, 0, "listItem"), node(5, 4, 0, "paragraph"), node(6, 4, 1, "bulletList"), node(7, 6, 0, "listItem"), node(8, 7, 0, "paragraph"),
		node(9, 1, 9, "table"), node(10, 9, 0, "tableRow"), node(11, 10, 0, "tableHeader"), node(12, 11, 0, "paragraph"),
		node(13, 10, 1, "tableCell"), node(14, 13, 0, "paragraph"),
		node(15, 9, 1, "tableRow"), node(16, 15, 0, "tableCell"), node(17, 16, 0, "paragraph"), node(18, 15, 1, "tableCell"), node(19, 18, 0, "paragraph"),
	}, Text: []TextNode{text(2, 0, "Heading"), text(5, 0, "Outer"), text(8, 0, "Inner"), text(12, 0, "A"), text(14, 0, "B"), text(17, 0, "C")}}
	got, err := Extract(input)
	if want := "Heading\nOuter\nInner\nA\tB\nC\t"; err != nil || got != want {
		t.Fatalf("got=%q err=%v", got, err)
	}
}

func TestExtractWhitespaceUnicodeAndEmptyBlocks(t *testing.T) {
	for _, value := range []string{"", "  ", "\tline 1\n\n  line 2\n", "తెలుగు café e\u0301 👩‍💻\u00a0"} {
		input := paragraph()
		input.Content[1].Type = "codeBlock"
		input.Text = []TextNode{text(2, 0, value)}
		got, err := Extract(input)
		if err != nil || got != value {
			t.Fatalf("got=%q want=%q err=%v", got, value, err)
		}
	}
	input := paragraph()
	input.Content = append(input.Content, node(3, 1, 1, "paragraph"))
	got, err := Extract(input)
	if err != nil || got != "\n" {
		t.Fatalf("two empty blocks got=%q err=%v", got, err)
	}
}

func TestExtractMermaidTextChildren(t *testing.T) {
	input := paragraph()
	input.Content[1].Type = "mermaid"
	input.Text = []TextNode{text(2, 0, "graph TD;\n  A-->B\n")}
	got, err := Extract(input)
	if err != nil || got != "graph TD;\n  A-->B\n" {
		t.Fatalf("got=%q err=%v", got, err)
	}
}

func TestExtractAttributeNodes(t *testing.T) {
	cases := []struct {
		kind  string
		attrs map[string]any
		want  string
	}{
		{"mention", map[string]any{"label": "Alex", "id": "private-id"}, "Alex"},
		{"imageBlock", map[string]any{"caption": "Caption", "alt": "Alt", "src": "private-url"}, "Caption\nAlt"},
		{"inlineMath", map[string]any{"latex": `x^2`}, `x^2`},
		{"mathBlock", map[string]any{"latex": `a+b`}, `a+b`},
		{"internalLinkBlock", map[string]any{"resourceTitle": "Guide", "href": "private-url"}, "Guide"},
		{"attachmentInline", map[string]any{"fileName": "guide.pdf", "fileUrl": "private-url"}, "guide.pdf"},
		{"embedInline", map[string]any{"title": "Video", "src": "private-url"}, "Video"},
		{"dateInline", map[string]any{"value": "2026-10-26"}, "2026-10-26"},
		{"statusBadge", map[string]any{"label": "Done"}, "Done"},
		{"tableOfContents", map[string]any{"title": "Do not duplicate"}, ""},
		{"childPagesList", map[string]any{"title": "Do not expand"}, ""},
		{"mention", map[string]any{"id": "private-id"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.kind, func(t *testing.T) {
			input := paragraph()
			input.Content[1].Type = tc.kind
			input.Content[1].Attrs = tc.attrs
			got, err := Extract(input)
			if err != nil || got != tc.want {
				t.Fatalf("got=%q err=%v", got, err)
			}
		})
	}
}

func TestExtractKnownContainers(t *testing.T) {
	for _, kind := range []string{"orderedList", "taskList", "taskItem", "blockquote", "columns", "column", "details", "detailsContent", "detailsSummary", "noteBlock"} {
		t.Run(kind, func(t *testing.T) {
			input := paragraph()
			input.Content[1].Type = kind
			input.Content = append(input.Content, node(3, 2, 0, "paragraph"), node(4, 2, 1, "paragraph"))
			input.Text = []TextNode{text(3, 0, "A"), text(4, 0, "B")}
			want := "A\nB"
			if kind == "noteBlock" || kind == "detailsSummary" {
				want = "AB"
			}
			got, err := Extract(input)
			if err != nil || got != want {
				t.Fatalf("got=%q err=%v", got, err)
			}
		})
	}
}

func TestExtractRejectsMalformedInput(t *testing.T) {
	cases := []struct {
		name, kind string
		mutate     func(*DocumentNodes)
	}{
		{"missing root", "missing_root", func(d *DocumentNodes) { d.Content = nil }},
		{"multiple roots", "missing_root", func(d *DocumentNodes) { d.Content[1].ParentID = uuid.Nil }},
		{"wrong root", "invalid_root", func(d *DocumentNodes) { d.Content[0].Type = "paragraph" }},
		{"nested doc", "invalid_root", func(d *DocumentNodes) { d.Content[1].Type = "doc" }},
		{"duplicate ID", "duplicate_id", func(d *DocumentNodes) { d.Content = append(d.Content, d.Content[1]) }},
		{"missing parent", "missing_parent", func(d *DocumentNodes) { d.Content[1].ParentID = id(99) }},
		{"orphan text", "missing_parent", func(d *DocumentNodes) { d.Text = []TextNode{text(99, 0, "x")} }},
		{"cross version content", "invalid_node", func(d *DocumentNodes) { d.Content[1].DocID = 9 }},
		{"cross version text", "invalid_text", func(d *DocumentNodes) { n := text(2, 0, "x"); n.DocID = 9; d.Text = []TextNode{n} }},
		{"negative order", "invalid_node", func(d *DocumentNodes) { d.Content[1].Order = -1 }},
		{"mixed duplicate order", "ambiguous_order", func(d *DocumentNodes) {
			d.Content = append(d.Content, node(3, 2, 0, "mention"))
			d.Text = []TextNode{text(2, 0, "x")}
		}},
		{"duplicate text order", "ambiguous_order", func(d *DocumentNodes) { d.Text = []TextNode{text(2, 0, "a"), text(2, 0, "b")} }},
		{"detached self cycle", "unreachable_node", func(d *DocumentNodes) { d.Content = append(d.Content, node(3, 3, 0, "paragraph")) }},
		{"detached cycle", "unreachable_node", func(d *DocumentNodes) {
			d.Content = append(d.Content, node(3, 4, 0, "paragraph"), node(4, 3, 0, "paragraph"))
		}},
		{"unknown node", "unsupported_node", func(d *DocumentNodes) { d.Content[1].Type = "unknown-future-node" }},
		{"leaf children", "invalid_children", func(d *DocumentNodes) { d.Content[1].Type = "mention"; d.Text = []TextNode{text(2, 0, "x")} }},
		{"invalid attr", "invalid_attribute", func(d *DocumentNodes) {
			d.Content[1].Type = "mention"
			d.Content[1].Attrs = map[string]any{"label": false}
		}},
		{"invalid utf8", "invalid_text", func(d *DocumentNodes) { d.Text = []TextNode{text(2, 0, string([]byte{0xff}))} }},
		{"body limit", "limit_exceeded", func(d *DocumentNodes) { d.Text = []TextNode{text(2, 0, strings.Repeat("a", MaxBodyBytes+1))} }},
		{"node limit", "limit_exceeded", func(d *DocumentNodes) { d.Content = make([]ContentNode, MaxNodes+1) }},
		{"depth limit", "limit_exceeded", func(d *DocumentNodes) {
			for i := 3; i < MaxDepth+4; i++ {
				d.Content = append(d.Content, node(i, i-1, 0, "blockquote"))
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := paragraph()
			tc.mutate(&input)
			got, err := Extract(input)
			var detail *Error
			if got != "" || !errors.As(err, &detail) || detail.Kind != tc.kind {
				t.Fatalf("got=%q err=%v want=%s", got, err, tc.kind)
			}
		})
	}
}

func TestDecodeAndGeneratePublished(t *testing.T) {
	input := PublishedNodes{Metadata: Metadata{PageID: 12, SpaceID: id(90), CreatedBy: id(91), Title: "Title", CreatedAt: time.Date(2026, 10, 1, 1, 0, 0, 0, time.FixedZone("offset", 19800)), UpdatedAt: time.Date(2026, 10, 2, 1, 0, 0, 123000, time.UTC)}, DocumentNodes: paragraph()}
	input.Text = []TextNode{text(2, 0, "Body")}
	raw, _ := json.Marshal(input)
	decoded, err := DecodePublished(raw)
	if err != nil {
		t.Fatal(err)
	}
	got, err := decoded.Generate()
	if err != nil || got.BodyText != "Body" {
		t.Fatalf("got=%+v err=%v", got, err)
	}
	if got.CreatedAt.Location() != time.UTC || !got.CreatedAt.Equal(input.CreatedAt) || !got.UpdatedAt.Equal(input.UpdatedAt) {
		t.Fatal("timestamps changed")
	}
	output, _ := json.Marshal(got)
	var fields map[string]any
	json.Unmarshal(output, &fields)
	if len(fields) != 8 {
		t.Fatalf("expected eight fields, got %s", output)
	}
	for _, replacement := range []string{`"orderId":null`, `"missingOrder":0`} {
		bad := strings.Replace(string(raw), `"orderId":0`, replacement, 1)
		if _, err := DecodePublished([]byte(bad)); err == nil {
			t.Fatalf("accepted %s", replacement)
		}
	}
	bad := strings.Replace(string(raw), `"text":"Body"`, `"text":null`, 1)
	if _, err := DecodePublished([]byte(bad)); err == nil {
		t.Fatal("accepted null text")
	}
	decoded.CreatedAt = time.Time{}
	if _, err := decoded.Generate(); err == nil {
		t.Fatal("accepted missing timestamp")
	}
	if !reflect.DeepEqual(input.DocumentNodes.Content, paragraph().Content) {
		t.Fatal("input mutated")
	}
}

func TestGenerateTitleOnlyPublication(t *testing.T) {
	input := PublishedNodes{
		Metadata:      Metadata{PageID: 130, SpaceID: id(90), CreatedBy: id(91), Title: "Title only", CreatedAt: time.Date(2026, 9, 15, 1, 0, 0, 0, time.UTC), UpdatedAt: time.Date(2026, 9, 15, 1, 0, 1, 0, time.UTC)},
		DocumentNodes: DocumentNodes{DocID: 209},
	}
	for _, emptySlices := range []bool{false, true} {
		if emptySlices {
			input.Content = []ContentNode{}
			input.Text = []TextNode{}
		}
		got, err := input.Generate()
		if err != nil || got.BodyText != "" || got.DocID != 209 || !reflect.DeepEqual(got.Metadata, input.Metadata) {
			t.Fatalf("title-only publication changed: got=%+v err=%v", got, err)
		}
	}
	input.DocID = 0
	if _, err := input.Generate(); err == nil {
		t.Fatal("title-only publication bypassed metadata validation")
	}
}

func TestGenerateDoesNotEmptyMalformedPublication(t *testing.T) {
	input := PublishedNodes{
		Metadata:      Metadata{PageID: 12, SpaceID: id(90), CreatedBy: id(91), CreatedAt: time.Now(), UpdatedAt: time.Now()},
		DocumentNodes: DocumentNodes{DocID: 7, Text: []TextNode{text(99, 0, "Orphan")}},
	}
	if _, err := input.Generate(); err == nil {
		t.Fatal("text without a content tree was silently emptied")
	}
	input.DocumentNodes = paragraph()
	input.Content[1].ParentID = id(99)
	if _, err := input.Generate(); err == nil {
		t.Fatal("broken content tree was silently emptied")
	}
}
