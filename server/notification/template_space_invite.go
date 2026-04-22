package notification

import "fmt"

const TemplateSpaceInviteCreated = "space_invite_created"

type SpaceInviteCreatedTemplate struct{}

func (SpaceInviteCreatedTemplate) Key() string {
	return TemplateSpaceInviteCreated
}

func (SpaceInviteCreatedTemplate) RequiredFields() []string {
	return []string{
		"space_name",
		"sender_name",
		"role",
		"accept_url",
		"reject_url",
		"app_url",
	}
}

func (t SpaceInviteCreatedTemplate) Render(data map[string]any) (RenderedEmail, error) {
	if err := requireTemplateFields(data, t.RequiredFields()); err != nil {
		return RenderedEmail{}, err
	}

	spaceName := templateString(data, "space_name")
	senderName := templateString(data, "sender_name")
	role := templateString(data, "role")
	acceptURL := templateString(data, "accept_url")
	rejectURL := templateString(data, "reject_url")
	appURL := templateString(data, "app_url")

	subject := fmt.Sprintf("%s invited you to %s", senderName, spaceName)
	text := fmt.Sprintf(`%s invited you to join %s as %s.

Accept the invitation:
%s

Reject the invitation:
%s

Open Beskar:
%s
`, senderName, spaceName, role, acceptURL, rejectURL, appURL)

	htmlBody := fmt.Sprintf(`<!doctype html>
<html>
  <body>
    <p>%s invited you to join <strong>%s</strong> as <strong>%s</strong>.</p>
    <p><a href="%s">Accept invitation</a></p>
    <p><a href="%s">Reject invitation</a></p>
    <p><a href="%s">Open Beskar</a></p>
  </body>
</html>`,
		htmlEscape(senderName),
		htmlEscape(spaceName),
		htmlEscape(role),
		htmlEscape(acceptURL),
		htmlEscape(rejectURL),
		htmlEscape(appURL),
	)

	rendered := RenderedEmail{Subject: subject, Text: text, HTML: htmlBody}
	if err := validateRenderedEmail(rendered); err != nil {
		return RenderedEmail{}, err
	}
	return rendered, nil
}
