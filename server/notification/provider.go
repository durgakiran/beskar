package notification

import (
	"context"
	"errors"
)

type OutboundEmail struct {
	FromAddress string
	FromName    string
	ToAddress   string
	ToName      string
	Subject     string
	TextBody    string
	HTMLBody    string
}

type ProviderResult struct {
	MessageID string
}

type EmailProvider interface {
	Name() string
	Send(ctx context.Context, msg OutboundEmail) (ProviderResult, error)
}

type ProviderErrorKind string

const (
	ProviderErrorTransient ProviderErrorKind = "transient"
	ProviderErrorPermanent ProviderErrorKind = "permanent"
)

type ProviderError struct {
	Kind    ProviderErrorKind
	Code    string
	Message string
	Err     error
}

func (e *ProviderError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return string(e.Kind)
}

func (e *ProviderError) Unwrap() error {
	return e.Err
}

func providerErrorKind(err error) ProviderErrorKind {
	var providerErr *ProviderError
	if errors.As(err, &providerErr) {
		return providerErr.Kind
	}
	return ProviderErrorTransient
}

func providerErrorCode(err error) string {
	var providerErr *ProviderError
	if errors.As(err, &providerErr) && providerErr.Code != "" {
		return providerErr.Code
	}
	return "provider_error"
}

func providerErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 500 {
		return message[:500]
	}
	return message
}

type disabledProvider struct{}

func (disabledProvider) Name() string {
	return "disabled"
}

func (disabledProvider) Send(ctx context.Context, msg OutboundEmail) (ProviderResult, error) {
	return ProviderResult{}, &ProviderError{Kind: ProviderErrorPermanent, Code: "email_disabled", Message: "email notifications are disabled"}
}
