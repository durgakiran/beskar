package notification

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	netmail "net/mail"
	"strings"
	"time"

	gomail "github.com/wneessen/go-mail"
)

type SMTPProvider struct {
	config Config
}

func NewSMTPProvider(config Config) *SMTPProvider {
	return &SMTPProvider{config: config}
}

func (p *SMTPProvider) Name() string {
	return "smtp"
}

func (p *SMTPProvider) Send(ctx context.Context, msg OutboundEmail) (ProviderResult, error) {
	if strings.TrimSpace(p.config.SMTPHost) == "" {
		return ProviderResult{}, &ProviderError{Kind: ProviderErrorPermanent, Code: "smtp_host_missing", Message: "SMTP_HOST is required"}
	}
	if strings.TrimSpace(p.config.FromAddress) == "" {
		return ProviderResult{}, &ProviderError{Kind: ProviderErrorPermanent, Code: "from_address_missing", Message: "EMAIL_FROM_ADDRESS is required"}
	}

	email, messageID, err := buildGoMailMessage(msg)
	if err != nil {
		return ProviderResult{}, &ProviderError{Kind: ProviderErrorPermanent, Code: "message_build_failed", Message: err.Error(), Err: err}
	}

	timeout := p.config.SMTPTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	options := []gomail.Option{
		gomail.WithPort(p.config.SMTPPort),
		gomail.WithTimeout(timeout),
	}
	if p.config.SMTPUseTLS {
		options = append(options, gomail.WithTLSPolicy(gomail.TLSMandatory))
		if p.config.SMTPPort == 465 {
			options = append(options, gomail.WithSSL())
		}
	} else {
		options = append(options, gomail.WithTLSPolicy(gomail.NoTLS))
	}

	if p.config.SMTPUsername != "" || p.config.SMTPPassword != "" {
		authType := gomail.SMTPAuthPlain
		if !p.config.SMTPUseTLS {
			authType = gomail.SMTPAuthPlainNoEnc
		}
		options = append(options,
			gomail.WithSMTPAuth(authType),
			gomail.WithUsername(p.config.SMTPUsername),
			gomail.WithPassword(p.config.SMTPPassword),
		)
	}

	client, err := gomail.NewClient(p.config.SMTPHost, options...)
	if err != nil {
		return ProviderResult{}, &ProviderError{Kind: ProviderErrorPermanent, Code: "smtp_client_create_failed", Message: err.Error(), Err: err}
	}

	if err := client.DialAndSendWithContext(ctx, email); err != nil {
		return ProviderResult{}, &ProviderError{Kind: classifySMTPError(err), Code: "smtp_send_failed", Message: err.Error(), Err: err}
	}

	return ProviderResult{MessageID: messageID}, nil
}

func buildGoMailMessage(msg OutboundEmail) (*gomail.Msg, string, error) {
	from := netmail.Address{Name: msg.FromName, Address: msg.FromAddress}
	to := netmail.Address{Name: msg.ToName, Address: msg.ToAddress}
	messageID := fmt.Sprintf("%s@beskar.local", randomHex(16))

	email := gomail.NewMsg()
	if err := email.From(from.String()); err != nil {
		return nil, "", err
	}
	if err := email.To(to.String()); err != nil {
		return nil, "", err
	}
	email.Subject(msg.Subject)
	email.SetMessageIDWithValue(messageID)
	email.SetBulk()
	email.SetBodyString(gomail.TypeTextPlain, msg.TextBody)
	if strings.TrimSpace(msg.HTMLBody) != "" {
		email.AddAlternativeString(gomail.TypeTextHTML, msg.HTMLBody)
	}

	return email, messageID, nil
}

func classifySMTPError(err error) ProviderErrorKind {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return ProviderErrorTransient
	}

	lowerErr := strings.ToLower(err.Error())
	for _, marker := range []string{
		"auth",
		"authentication",
		"invalid recipient",
		"mailbox",
		"no such user",
		"recipient address rejected",
		"user unknown",
		"550 ",
		"553 ",
	} {
		if strings.Contains(lowerErr, marker) {
			return ProviderErrorPermanent
		}
	}

	for _, marker := range []string{
		"timeout",
		"temporary",
		"connection",
		"refused",
		"network",
		"try again",
		"rate limit",
		"too many",
		"unavailable",
	} {
		if strings.Contains(lowerErr, marker) {
			return ProviderErrorTransient
		}
	}

	return ProviderErrorTransient
}

func randomHex(length int) string {
	buf := make([]byte, length)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
