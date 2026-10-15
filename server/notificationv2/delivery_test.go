package notificationv2

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
)

func TestDeliveryRendering(t *testing.T) {
	d := deliveryRecord{ID: uuid.New(), UserID: uuid.New(), Mode: "email", Destination: json.RawMessage(`{"email":"User@EXAMPLE.COM"}`), VariableSchema: json.RawMessage(`{"type":"object","required":["name"]}`), MessageDetails: json.RawMessage(`{"name":"<b>Alice</b>"}`), TemplateDetails: json.RawMessage(`{"subject":"Hi {{.name}}","text_body":"Hello {{.name}}","html_body":"<p>{{.name}}</p>"}`)}
	email, _, err := renderDelivery(d)
	if err != nil {
		t.Fatal(err)
	}
	if email.HTMLBody != "<p>&lt;b&gt;Alice&lt;/b&gt;</p>" || email.ToAddress != "User@example.com" {
		t.Fatalf("unsafe HTML or wrong address %+v", email)
	}
	d.TemplateDetails = json.RawMessage(`{"subject":"{{.missing}}","text_body":"hi"}`)
	if _, _, err = renderDelivery(d); err == nil {
		t.Fatal("missing variable ignored")
	}
	d.TemplateDetails = json.RawMessage(`{"subject":"hi\r\nBcc: other@example.com","text_body":"hi"}`)
	if _, _, err = renderDelivery(d); err == nil {
		t.Fatal("header injection accepted")
	}
	d.Mode = "in_app"
	d.TypeCode = "event"
	d.TopicCode = "document_invitation"
	d.TemplateDetails = json.RawMessage(`{"title":"Hi {{.name}}","target_type":"page","target_id":"123","actions":[{"key":"view","label":"View","method":"GET","url":"javascript:alert(1)"}]}`)
	if _, _, err = renderDelivery(d); err == nil {
		t.Fatal("unsafe action URL accepted")
	}
	d.TemplateDetails = json.RawMessage(`{"title":"Hi {{.name}}","target_type":"page","target_id":"123","page_id":"123","actions":[{"key":"view","label":"View","method":"GET","url":"/page/123"}]}`)
	_, inbox, err := renderDelivery(d)
	if err != nil || inbox.EventKey != "notification-v2-delivery:"+d.ID.String() || inbox.Target.PageID == nil || *inbox.Target.PageID != 123 {
		t.Fatalf("in-app render %+v %v", inbox, err)
	}
	d.TemplateDetails = json.RawMessage(`{"title":"Invitation","target_type":"invite","target_id":"invite-token"}`)
	_, inbox, err = renderDelivery(d)
	if err != nil || inbox.Data["token"] != "invite-token" {
		t.Fatalf("invitation linkage: %+v %v", inbox, err)
	}
}

func TestDeliveryConfigRequiresExplicitEmailBinding(t *testing.T) {
	c := DefaultDeliveryConfig()
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	c.EmailEnabled = true
	c.HashKey = []byte("01234567890123456789012345678901")
	if err := c.validate(); err == nil {
		t.Fatal("unbound SMTP accepted")
	}
	c.SMTPProviderID = uuid.New()
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	c.LeaseDuration = c.SendTimeout
	if err := c.validate(); err == nil {
		t.Fatal("short lease accepted")
	}
}

// Local SMTP only: exercise the actual existing sender and its typed go-mail
// errors, without relying on an external account or sending any real message.
func TestExistingSMTPAdapterOutcomes(t *testing.T) {
	for _, tc := range []struct{ name, stage, reply, want string }{
		{"accepted", "data", "250 queued", "accepted"},
		{"temporary rejection", "data", "451 try again", "transient_failure"},
		{"permanent rejection", "recipient", "550 no such user", "permanent_failure"},
		{"connection lost after DATA", "data", "drop", "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			done := make(chan struct{})
			go func() {
				defer close(done)
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
				reader := bufio.NewReader(conn)
				writer := bufio.NewWriter(conn)
				say := func(s string) { _, _ = fmt.Fprintf(writer, "%s\r\n", s); _ = writer.Flush() }
				say("220 localhost SMTP")
				for {
					line, err := reader.ReadString('\n')
					if err != nil {
						return
					}
					upper := strings.ToUpper(strings.TrimSpace(line))
					switch {
					case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "HELO"):
						say("250 localhost")
					case strings.HasPrefix(upper, "MAIL FROM"):
						say("250 OK")
					case strings.HasPrefix(upper, "RCPT TO"):
						if tc.stage == "recipient" {
							say(tc.reply)
						} else {
							say("250 OK")
						}
					case upper == "DATA":
						say("354 end with dot")
						for {
							body, err := reader.ReadString('\n')
							if err != nil {
								return
							}
							if strings.TrimSpace(body) == "." {
								break
							}
						}
						if tc.reply == "drop" {
							return
						}
						say(tc.reply)
					case upper == "QUIT":
						say("221 bye")
						return
					default:
						say("250 OK")
					}
				}
			}()
			cfg := notification.Config{SMTPHost: "127.0.0.1", SMTPPort: listener.Addr().(*net.TCPAddr).Port, SMTPTimeout: 2 * time.Second, FromAddress: "sender@example.com"}
			provider := notification.NewSMTPProvider(cfg)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, sendErr := provider.Send(ctx, notification.OutboundEmail{FromAddress: cfg.FromAddress, ToAddress: "recipient@example.com", Subject: "Test", TextBody: "Local test"})
			status, _ := classifyDeliveryError(sendErr)
			if status != tc.want {
				t.Fatalf("status %s want %s; error %v", status, tc.want, sendErr)
			}
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("local SMTP did not close")
			}
		})
	}
}
