package notificationv2

import (
	"bytes"
	"encoding/json"
	"fmt"
	htmltemplate "html/template"
	"net/url"
	"strconv"
	"strings"
	texttemplate "text/template"
	"time"

	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
)

type deliveryTemplate struct {
	CreatedAt      string                            `json:"created_at"`
	Category       string                            `json:"category"`
	Data           map[string]string                 `json:"data"`
	Subject        string                            `json:"subject"`
	Text           string                            `json:"text_body"`
	HTML           string                            `json:"html_body"`
	Title          string                            `json:"title"`
	Body           string                            `json:"body"`
	TargetType     string                            `json:"target_type"`
	TargetID       string                            `json:"target_id"`
	SpaceID        string                            `json:"space_id"`
	PageID         string                            `json:"page_id"`
	ActorID        string                            `json:"actor_user_id"`
	ActorName      string                            `json:"actor_name"`
	Actions        []notification.NotificationAction `json:"actions"`
	ActionRequired bool                              `json:"action_required"`
}
type limitedTemplateBuffer struct{ bytes.Buffer }

func (b *limitedTemplateBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 1024*1024 {
		return 0, fmt.Errorf("rendered template exceeds 1 MiB")
	}
	return b.Buffer.Write(p)
}
func renderField(source string, data map[string]any, html bool) (string, error) {
	var out limitedTemplateBuffer
	if html {
		t, err := htmltemplate.New("notification").Option("missingkey=error").Parse(source)
		if err != nil {
			return "", err
		}
		err = t.Execute(&out, data)
		return out.String(), err
	}
	t, err := texttemplate.New("notification").Option("missingkey=error").Parse(source)
	if err != nil {
		return "", err
	}
	err = t.Execute(&out, data)
	return out.String(), err
}
func renderDelivery(d deliveryRecord) (notification.OutboundEmail, notification.EmitNotificationRequest, error) {
	var mail notification.OutboundEmail
	var inbox notification.EmitNotificationRequest
	var tpl deliveryTemplate
	if len(d.TemplateDetails) > 1024*1024 || json.Unmarshal(d.TemplateDetails, &tpl) != nil {
		return mail, inbox, fmt.Errorf("invalid template details")
	}
	if err := validateVariables(d.VariableSchema, d.MessageDetails); err != nil {
		return mail, inbox, err
	}
	var vars map[string]any
	dec := json.NewDecoder(bytes.NewReader(d.MessageDetails))
	dec.UseNumber()
	if err := dec.Decode(&vars); err != nil || vars == nil {
		return mail, inbox, fmt.Errorf("invalid message variables")
	}
	render := func(source string) (string, error) { return renderField(source, vars, false) }
	var err error
	if d.Mode == "email" {
		if mail.Subject, err = render(tpl.Subject); err != nil {
			return mail, inbox, err
		}
		if strings.TrimSpace(mail.Subject) == "" || strings.ContainsAny(mail.Subject, "\r\n") || len(mail.Subject) > 998 {
			return mail, inbox, fmt.Errorf("invalid email subject")
		}
		if mail.TextBody, err = render(tpl.Text); err != nil {
			return mail, inbox, err
		}
		if strings.TrimSpace(mail.TextBody) == "" {
			return mail, inbox, fmt.Errorf("email text body required")
		}
		if mail.HTMLBody, err = renderField(tpl.HTML, vars, true); err != nil {
			return mail, inbox, err
		}
		var dest struct {
			Email string `json:"email"`
		}
		if json.Unmarshal(d.Destination, &dest) != nil {
			return mail, inbox, fmt.Errorf("invalid destination")
		}
		mail.ToAddress, err = NormalizeDestination("email", dest.Email)
		return mail, inbox, err
	}
	inbox.EventKey = "notification-v2-delivery:" + d.ID.String()
	inbox.Type = d.TopicCode
	inbox.Category = d.TypeCode
	if tpl.Category != "" {
		inbox.Category = tpl.Category
	}
	inbox.Recipients = []notification.NotificationRecipient{{UserID: &d.UserID}}
	if tpl.CreatedAt != "" {
		value, e := render(tpl.CreatedAt)
		if e != nil {
			return mail, inbox, e
		}
		if value != "" {
			at, e := time.Parse(time.RFC3339Nano, value)
			if e != nil {
				return mail, inbox, fmt.Errorf("invalid inbox created_at")
			}
			inbox.CreatedAt = &at
		}
	}
	inbox.ActorVisible = true
	inbox.ExpiresAt = d.ExpiresAt
	inbox.ActionRequired = tpl.ActionRequired
	inbox.Data = map[string]any{"notification_v2_delivery_id": d.ID.String(), "notification_v2_event_id": d.EventID.String()}
	for _, v := range []struct {
		source string
		target *string
	}{{tpl.Title, &inbox.Title}, {tpl.Body, &inbox.Body}, {tpl.TargetType, &inbox.Target.Type}, {tpl.TargetID, &inbox.Target.ID}, {tpl.ActorName, &inbox.Actor.Name}} {
		*v.target, err = render(v.source)
		if err != nil {
			return mail, inbox, err
		}
	}
	for key, source := range tpl.Data {
		if key == "notification_v2_delivery_id" || key == "notification_v2_event_id" {
			return mail, inbox, fmt.Errorf("reserved inbox data key")
		}
		value, e := render(source)
		if e != nil {
			return mail, inbox, e
		}
		inbox.Data[key] = value
	}
	// The existing invitation UI submits data.token to the decision endpoint.
	// Derive it from the same target used for resolution, avoiding two identities.
	if inbox.Target.Type == notification.NotificationTargetInvite {
		inbox.Data["token"] = inbox.Target.ID
	}
	if strings.TrimSpace(inbox.Title) == "" || strings.TrimSpace(inbox.Target.Type) == "" || strings.TrimSpace(inbox.Target.ID) == "" || inbox.Type == "" || inbox.Category == "" {
		return mail, inbox, fmt.Errorf("in-app title, target and topic required")
	}
	for _, v := range []struct {
		source string
		target **uuid.UUID
	}{{tpl.SpaceID, &inbox.Target.SpaceID}} {
		if v.source != "" {
			raw, e := render(v.source)
			if e != nil {
				return mail, inbox, e
			}
			if raw == "" {
				continue
			}
			id, e := uuid.Parse(raw)
			if e != nil || id == uuid.Nil {
				return mail, inbox, fmt.Errorf("invalid space ID")
			}
			*v.target = &id
		}
	}
	if tpl.ActorID != "" {
		raw, e := render(tpl.ActorID)
		if e != nil {
			return mail, inbox, e
		}
		id, e := uuid.Parse(raw)
		if e != nil {
			return mail, inbox, e
		}
		inbox.Actor.UserID = id
	}
	if tpl.PageID != "" {
		raw, e := render(tpl.PageID)
		if e != nil {
			return mail, inbox, e
		}
		if raw != "" {
			id, e := strconv.ParseInt(raw, 10, 64)
			if e != nil || id < 1 {
				return mail, inbox, fmt.Errorf("invalid page ID")
			}
			inbox.Target.PageID = &id
		}
	}
	inbox.Actions = []notification.NotificationAction{}
	for _, action := range tpl.Actions {
		for _, field := range []*string{&action.Key, &action.Label, &action.URL} {
			*field, err = render(*field)
			if err != nil {
				return mail, inbox, err
			}
		}
		u, e := url.Parse(action.URL)
		if e != nil || u.User != nil || strings.ContainsAny(action.URL, "\r\n\\") || !(u.Scheme == "https" && u.Host != "" || u.Scheme == "" && u.Host == "" && strings.HasPrefix(action.URL, "/") && !strings.HasPrefix(action.URL, "//")) {
			return mail, inbox, fmt.Errorf("invalid action URL")
		}
		switch action.Method {
		case "GET", "POST", "PATCH", "PUT", "DELETE":
		default:
			return mail, inbox, fmt.Errorf("invalid action method")
		}
		if action.Key == "" || action.Label == "" {
			return mail, inbox, fmt.Errorf("action key and label required")
		}
		inbox.Actions = append(inbox.Actions, action)
	}
	if inbox.ActionRequired && len(inbox.Actions) == 0 {
		return mail, inbox, fmt.Errorf("required action missing")
	}
	return mail, inbox, nil
}
