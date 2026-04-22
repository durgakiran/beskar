package notification

import (
	"errors"
	"fmt"
	"html"
	"strings"
)

type RenderedEmail struct {
	Subject string
	Text    string
	HTML    string
}

type EmailTemplate interface {
	Key() string
	RequiredFields() []string
	Render(data map[string]any) (RenderedEmail, error)
}

type TemplateRegistry struct {
	templates map[string]EmailTemplate
}

func NewTemplateRegistry() *TemplateRegistry {
	registry := &TemplateRegistry{templates: map[string]EmailTemplate{}}
	registry.Register(SpaceInviteCreatedTemplate{})
	return registry
}

func (r *TemplateRegistry) Register(template EmailTemplate) {
	r.templates[template.Key()] = template
}

func (r *TemplateRegistry) Render(templateKey string, data map[string]any) (RenderedEmail, error) {
	template, ok := r.templates[templateKey]
	if !ok {
		return RenderedEmail{}, fmt.Errorf("unknown email template: %s", templateKey)
	}
	return template.Render(data)
}

func requireTemplateFields(data map[string]any, fields []string) error {
	for _, field := range fields {
		value, ok := data[field]
		if !ok {
			return fmt.Errorf("missing template field: %s", field)
		}
		if strings.TrimSpace(fmt.Sprint(value)) == "" {
			return fmt.Errorf("missing template field: %s", field)
		}
	}
	return nil
}

func templateString(data map[string]any, field string) string {
	return strings.TrimSpace(fmt.Sprint(data[field]))
}

func htmlEscape(value string) string {
	return html.EscapeString(value)
}

func validateRenderedEmail(rendered RenderedEmail) error {
	if strings.TrimSpace(rendered.Subject) == "" {
		return errors.New("rendered email subject is empty")
	}
	if strings.TrimSpace(rendered.Text) == "" {
		return errors.New("rendered email text body is empty")
	}
	if strings.TrimSpace(rendered.HTML) == "" {
		return errors.New("rendered email html body is empty")
	}
	return nil
}
