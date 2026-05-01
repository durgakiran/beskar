package assetcleanup

import (
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/durgakiran/beskar/assetref"
	"github.com/durgakiran/beskar/editor"
)

var imagePathPattern = regexp.MustCompile(`/media/image/([^/?#]+)$`)

func extractImagePublicName(src string) string {
	trimmed := strings.TrimSpace(src)
	if trimmed == "" {
		return ""
	}

	pathValue := trimmed
	if parsed, err := url.Parse(trimmed); err == nil && parsed.Path != "" {
		pathValue = parsed.Path
	}

	match := imagePathPattern.FindStringSubmatch(pathValue)
	if len(match) < 2 {
		return ""
	}
	publicName, err := url.PathUnescape(match[1])
	if err != nil {
		return ""
	}
	return strings.TrimSpace(publicName)
}

func ExtractPayloadReferencesFromNodeData(nodes editor.NodeData) *assetref.PayloadReferences {
	attachments := make(map[string]struct{})
	images := make(map[string]struct{})

	for _, node := range nodes.Content {
		switch node.Type {
		case "attachmentInline":
			if rawID, ok := node.Attributes["attachmentId"].(string); ok {
				attachmentID := strings.TrimSpace(rawID)
				if attachmentID != "" {
					attachments[attachmentID] = struct{}{}
				}
			}
		case "imageInline", "imageBlock":
			if rawSrc, ok := node.Attributes["src"].(string); ok {
				publicName := extractImagePublicName(rawSrc)
				if publicName != "" {
					images[publicName] = struct{}{}
				}
			}
		}
	}

	payload := &assetref.PayloadReferences{
		Attachments: make([]string, 0, len(attachments)),
		Images:      make([]string, 0, len(images)),
	}
	for attachmentID := range attachments {
		payload.Attachments = append(payload.Attachments, attachmentID)
	}
	for publicName := range images {
		payload.Images = append(payload.Images, publicName)
	}
	sort.Strings(payload.Attachments)
	sort.Strings(payload.Images)
	return payload
}
