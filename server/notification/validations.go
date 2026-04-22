package notification

import (
	"errors"
	"net/mail"
	"strings"
)

func validateEnqueueRequest(req EnqueueEmailRequest) (EnqueueEmailRequest, error) {
	req.MessageKey = strings.TrimSpace(req.MessageKey)
	req.Category = strings.TrimSpace(req.Category)
	req.TemplateKey = strings.TrimSpace(req.TemplateKey)
	req.Recipient.Email = NormalizeEmail(req.Recipient.Email)
	req.Priority = strings.TrimSpace(req.Priority)

	if req.MessageKey == "" {
		return req, errors.New("message_key is required")
	}
	if req.Category == "" {
		return req, errors.New("category is required")
	}
	if req.TemplateKey == "" {
		return req, errors.New("template_key is required")
	}
	if req.Recipient.Email == "" {
		return req, errors.New("recipient email is required")
	}
	if _, err := mail.ParseAddress(req.Recipient.Email); err != nil {
		return req, errors.New("recipient email is invalid")
	}
	if req.Priority == "" {
		req.Priority = PriorityNormal
	}
	if req.TemplateData == nil {
		req.TemplateData = map[string]any{}
	}
	return req, nil
}

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
