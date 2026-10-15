package notificationv2

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/mail"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/santhosh-tekuri/jsonschema/v5"
)

const maxTargets = 1000

func normalize(d *DefinitionInput) error {
	if d.Timezone == "" {
		d.Timezone = "UTC"
	}
	if d.TemplateID == uuid.Nil || d.TemplateVersion < 1 || d.NotificationTypeID < 1 || d.NotificationTopicID < 1 || d.ModeID < 1 {
		return invalid("valid type, topic, mode, template_id and positive template_version are required")
	}
	if d.Priority < 0 || d.Priority > 100 {
		return invalid("priority must be between 0 and 100")
	}
	if d.MisfirePolicy != "skip" && d.MisfirePolicy != "fire_once" {
		return invalid("misfire_policy must be skip or fire_once")
	}
	if d.DeliveryTTLSeconds != nil && (*d.DeliveryTTLSeconds < 1 || int64(*d.DeliveryTTLSeconds) > 2147483647) {
		return invalid("delivery_ttl_seconds must be a positive 32-bit integer")
	}
	if d.CorrelationID != nil && len(*d.CorrelationID) > 500 {
		return invalid("correlation_id exceeds 500 bytes")
	}
	if len(d.MessageDetails) == 0 || len(d.MessageDetails) > 65536 {
		return invalid("message_details must be a JSON object of at most 64 KiB")
	}
	dec := json.NewDecoder(bytes.NewReader(d.MessageDetails))
	dec.UseNumber()
	var value any
	if err := dec.Decode(&value); err != nil {
		return invalid("invalid message_details")
	}
	var trailing any
	if dec.Decode(&trailing) != io.EOF {
		return invalid("message_details must contain one JSON object")
	}
	if _, ok := value.(map[string]any); !ok {
		return invalid("message_details must be an object")
	}
	d.MessageDetails, _ = json.Marshal(value)
	if len(d.TargetUsers)+len(d.TargetSegments)+len(d.TargetEmails) > maxTargets {
		return invalid("at most 1000 target entries are allowed")
	}
	var err error
	if d.TargetUsers, err = normalizeIDs(d.TargetUsers); err != nil {
		return err
	}
	if d.TargetSegments, err = normalizeIDs(d.TargetSegments); err != nil {
		return err
	}
	emails := map[string]bool{}
	for _, email := range d.TargetEmails {
		email = strings.TrimSpace(email)
		parsed, err := mail.ParseAddress(email)
		if err != nil || parsed.Address != email || len(email) > 254 || strings.ContainsAny(email, "\r\n") {
			return invalid("target_emails must contain plain email addresses")
		}
		at := strings.LastIndex(email, "@")
		if at < 1 {
			return invalid("invalid email address")
		}
		// Preserve local-part case; normalize the case-insensitive domain only.
		email = email[:at+1] + strings.ToLower(email[at+1:])
		emails[email] = true
	}
	d.TargetEmails = []string{}
	for e := range emails {
		d.TargetEmails = append(d.TargetEmails, e)
	}
	sort.Strings(d.TargetEmails)
	if len(d.TargetUsers)+len(d.TargetSegments)+len(d.TargetEmails) == 0 {
		return invalid("at least one user, segment, or email target is required")
	}
	for _, field := range []**time.Time{&d.ScheduledAt, &d.StartsAt, &d.EndsAt} {
		if *field != nil {
			normalized := (*field).UTC().Truncate(time.Microsecond)
			*field = &normalized
		}
	}
	if d.CronExpression != nil {
		v := strings.Join(strings.Fields(*d.CronExpression), " ")
		d.CronExpression = &v
	}
	return nil
}
func normalizeIDs(ids []uuid.UUID) ([]uuid.UUID, error) {
	seen := map[uuid.UUID]bool{}
	out := []uuid.UUID{}
	for _, id := range ids {
		if id == uuid.Nil {
			return nil, invalid("target IDs must be nonzero UUIDs")
		}
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out, nil
}
func requestHash(d DefinitionInput) string {
	raw, _ := json.Marshal(d)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func validateVariables(schemaJSON, details []byte) error {
	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat = true
	compiler.LoadURL = func(string) (io.ReadCloser, error) { return nil, fmt.Errorf("external schema references are disabled") }
	const resource = "https://notification.invalid/template.json"
	if err := compiler.AddResource(resource, bytes.NewReader(schemaJSON)); err != nil {
		return conflict("template variable schema is invalid")
	}
	schema, err := compiler.Compile(resource)
	if err != nil {
		return conflict("template variable schema is invalid or uses external references")
	}
	decoder := json.NewDecoder(bytes.NewReader(details))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return invalid("invalid message_details")
	}
	if err := schema.Validate(value); err != nil {
		return invalid("message_details do not match the template variable schema")
	}
	return nil
}
