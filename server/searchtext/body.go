// Package searchtext extracts searchable text from a single published document's
// persisted content/text rows. It performs no database writes or network calls.
package searchtext

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	MaxNodes     = 100_000
	MaxDepth     = 256
	MaxBodyBytes = 8 << 20
)

type ContentNode struct {
	ID       uuid.UUID      `json:"contentId"`
	ParentID uuid.UUID      `json:"parentId"`
	DocID    int64          `json:"docId"`
	Order    int64          `json:"orderId"`
	Type     string         `json:"type"`
	Attrs    map[string]any `json:"attrs"`
}

type TextNode struct {
	ParentID uuid.UUID `json:"parentId"`
	DocID    int64     `json:"docId"`
	Order    int64     `json:"orderId"`
	Text     string    `json:"text"`
}

type DocumentNodes struct {
	DocID   int64         `json:"docId"`
	Content []ContentNode `json:"content"`
	Text    []TextNode    `json:"text"`
}

// Error identifies invalid input without including document text in diagnostics.
type Error struct {
	Kind   string
	DocID  int64
	NodeID uuid.UUID
	Detail string
}

func (e *Error) Error() string {
	return fmt.Sprintf("searchtext: %s (doc=%d node=%s): %s", e.Kind, e.DocID, e.NodeID, e.Detail)
}

type child struct {
	order  int64
	index  int
	isText bool
}

type documentIndex struct {
	root     uuid.UUID
	nodes    map[uuid.UUID]int
	children map[uuid.UUID][]child
}

// Extract returns an empty string for a valid empty document. Absent rows are
// diagnosed as missing_root, not silently classified as an empty publication.
// Input slices/maps are never mutated. No partial body is returned on failure.
func Extract(input DocumentNodes) (string, error) {
	fail := func(kind string, id uuid.UUID, detail string) error {
		return &Error{Kind: kind, DocID: input.DocID, NodeID: id, Detail: detail}
	}
	if input.DocID <= 0 {
		return "", fail("invalid_document", uuid.Nil, "docId must be positive")
	}
	if len(input.Content) > MaxNodes || len(input.Text) > MaxNodes-len(input.Content) {
		return "", fail("limit_exceeded", uuid.Nil, "too many nodes")
	}
	idx := documentIndex{nodes: make(map[uuid.UUID]int), children: make(map[uuid.UUID][]child)}
	roots := 0
	for i, node := range input.Content {
		if node.DocID != input.DocID || node.ID == uuid.Nil || node.Order < 0 {
			return "", fail("invalid_node", node.ID, "invalid document, identifier, or order")
		}
		if _, exists := idx.nodes[node.ID]; exists {
			return "", fail("duplicate_id", node.ID, "content identifier is repeated")
		}
		if _, ok := ruleFor(node.Type); !ok {
			return "", fail("unsupported_node", node.ID, "unrecognized content type")
		}
		idx.nodes[node.ID] = i
		if node.ParentID == uuid.Nil {
			roots++
			idx.root = node.ID
		} else {
			idx.children[node.ParentID] = append(idx.children[node.ParentID], child{order: node.Order, index: i})
		}
	}
	if roots != 1 {
		return "", fail("missing_root", uuid.Nil, "expected exactly one root")
	}
	if input.Content[idx.nodes[idx.root]].Type != "doc" {
		return "", fail("invalid_root", idx.root, "root must have type doc")
	}
	for i, node := range input.Text {
		if node.DocID != input.DocID || node.Order < 0 || !utf8.ValidString(node.Text) {
			return "", fail("invalid_text", node.ParentID, "invalid document, order, or UTF-8")
		}
		idx.children[node.ParentID] = append(idx.children[node.ParentID], child{order: node.Order, index: i, isText: true})
	}
	for parent, siblings := range idx.children {
		pos, exists := idx.nodes[parent]
		if !exists {
			return "", fail("missing_parent", parent, "parent content node does not exist")
		}
		rule, _ := ruleFor(input.Content[pos].Type)
		if rule.leaf {
			return "", fail("invalid_children", parent, "leaf node has children")
		}
		sort.Slice(siblings, func(i, j int) bool { return siblings[i].order < siblings[j].order })
		for i := 1; i < len(siblings); i++ {
			if siblings[i-1].order == siblings[i].order {
				return "", fail("ambiguous_order", parent, "siblings have the same order")
			}
		}
	}
	// Validate the full reachable tree before producing output. A detached cycle
	// or detached subtree is rejected by the final reachability check.
	visited := make(map[uuid.UUID]bool)
	var validate func(uuid.UUID, int) error
	validate = func(id uuid.UUID, depth int) error {
		if depth > MaxDepth {
			return fail("limit_exceeded", id, "tree is too deep")
		}
		if visited[id] {
			return fail("cycle", id, "content node visited twice")
		}
		visited[id] = true
		if id != idx.root && input.Content[idx.nodes[id]].Type == "doc" {
			return fail("invalid_root", id, "nested doc node")
		}
		for _, c := range idx.children[id] {
			if !c.isText {
				if err := validate(input.Content[c.index].ID, depth+1); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := validate(idx.root, 0); err != nil {
		return "", err
	}
	if len(visited) != len(input.Content) {
		return "", fail("unreachable_node", uuid.Nil, "content exists outside the root tree")
	}
	var body strings.Builder
	write := func(value string) error {
		if !utf8.ValidString(value) {
			return fail("invalid_text", uuid.Nil, "invalid UTF-8 in visible attribute")
		}
		if len(value) > MaxBodyBytes-body.Len() {
			return fail("limit_exceeded", uuid.Nil, "body is too large")
		}
		body.WriteString(value)
		return nil
	}
	var render func(uuid.UUID) error
	render = func(id uuid.UUID) error {
		node := input.Content[idx.nodes[id]]
		rule, _ := ruleFor(node.Type)
		if rule.omit {
			return nil
		}
		if node.Type == "hardBreak" {
			return write("\n")
		}
		if rule.leaf {
			var parts []string
			for _, key := range rule.attrs {
				value, exists := node.Attrs[key]
				if !exists || value == nil {
					continue
				}
				s, ok := value.(string)
				if !ok {
					return fail("invalid_attribute", id, "visible attribute must be a string")
				}
				if s != "" {
					if node.Type == "emoji" {
						if value, known := emojiTextByName[s]; known {
							s = value
						} else {
							s = ":" + s + ":"
						}
					}
					parts = append(parts, s)
				}
			}
			return write(strings.Join(parts, "\n"))
		}
		first := true
		for _, c := range idx.children[id] {
			if !c.isText {
				childRule, _ := ruleFor(input.Content[c.index].Type)
				if childRule.omit {
					continue
				}
			}
			if !first {
				if err := write(rule.separator); err != nil {
					return err
				}
			}
			first = false
			if c.isText {
				if err := write(input.Text[c.index].Text); err != nil {
					return err
				}
			} else if err := render(input.Content[c.index].ID); err != nil {
				return err
			}
		}
		return nil
	}
	if err := render(idx.root); err != nil {
		return "", err
	}
	return body.String(), nil
}

type nodeRule struct {
	separator  string
	leaf, omit bool
	attrs      []string
}

func ruleFor(kind string) (nodeRule, bool) {
	switch kind {
	case "doc", "blockquote", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "tableCell", "tableHeader", "columns", "column", "details", "detailsContent":
		return nodeRule{separator: "\n"}, true
	case "paragraph", "heading", "noteBlock", "detailsSummary", "codeBlock", "mermaid":
		return nodeRule{}, true
	case "tableRow":
		return nodeRule{separator: "\t"}, true
	case "hardBreak", "horizontalRule":
		return nodeRule{leaf: true}, true
	case "tableOfContents", "childPagesList":
		return nodeRule{leaf: true, omit: true}, true
	case "mention", "statusBadge":
		return nodeRule{leaf: true, attrs: []string{"label"}}, true
	case "emoji":
		return nodeRule{leaf: true, attrs: []string{"name"}}, true
	case "inlineMath", "mathBlock":
		return nodeRule{leaf: true, attrs: []string{"latex"}}, true
	case "imageBlock", "imageInline":
		return nodeRule{leaf: true, attrs: []string{"caption", "alt"}}, true
	case "attachmentInline", "attachmentBlock":
		return nodeRule{leaf: true, attrs: []string{"fileName"}}, true
	case "internalDocInline", "internalLinkBlock":
		return nodeRule{leaf: true, attrs: []string{"resourceTitle"}}, true
	case "externalLinkInline":
		return nodeRule{leaf: true, attrs: []string{"siteName", "title"}}, true
	case "embedInline", "embedBlock":
		return nodeRule{leaf: true, attrs: []string{"title"}}, true
	case "dateInline":
		return nodeRule{leaf: true, attrs: []string{"value"}}, true
	default:
		return nodeRule{}, false
	}
}
