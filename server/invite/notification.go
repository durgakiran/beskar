package invite

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
)

const (
	spaceInviteEmailCategory = "space_invite"
	spaceInviteAcceptPath    = "/api/v1/invite/user/accept"
	spaceInviteRejectPath    = "/api/v1/invite/user/reject"
)

func (i Invite) enqueueSpaceInviteCreatedEmail(ctx context.Context, token string, sender core.UserInfo) error {
	if i.Entity != "space" {
		return nil
	}

	config := notification.LoadConfig()
	if !config.NotificationsEnabled {
		return nil
	}

	spaceName, err := getSpaceNameForInviteEmail(ctx, i.EntityId)
	if err != nil {
		return err
	}

	req, err := buildSpaceInviteCreatedEmailRequest(config, i, token, spaceName, sender)
	if err != nil {
		return err
	}

	_, err = notification.NewService().EnqueueEmail(ctx, req)
	return err
}

func buildSpaceInviteCreatedEmailRequest(config notification.Config, i Invite, token string, spaceName string, sender core.UserInfo) (notification.EnqueueEmailRequest, error) {
	if strings.TrimSpace(token) == "" {
		return notification.EnqueueEmailRequest{}, fmt.Errorf("invite token is required")
	}
	if strings.TrimSpace(spaceName) == "" {
		return notification.EnqueueEmailRequest{}, fmt.Errorf("space name is required")
	}

	appURL := strings.TrimRight(strings.TrimSpace(config.AppBaseURL), "/")
	if appURL == "" {
		appURL = "/"
	}

	senderName := strings.TrimSpace(sender.Name)
	if senderName == "" {
		senderName = strings.TrimSpace(sender.Email)
	}
	if senderName == "" {
		senderName = "Someone"
	}

	var recipientUserID *uuid.UUID
	if i.UserId != uuid.Nil {
		userID := i.UserId
		recipientUserID = &userID
	}

	return notification.EnqueueEmailRequest{
		MessageKey:  fmt.Sprintf("%s:%s", notification.TemplateSpaceInviteCreated, token),
		Category:    spaceInviteEmailCategory,
		TemplateKey: notification.TemplateSpaceInviteCreated,
		Recipient: notification.EmailRecipient{
			UserID: recipientUserID,
			Email:  i.Email,
			Name:   i.Email,
		},
		TemplateData: map[string]any{
			"space_name":  spaceName,
			"sender_name": senderName,
			"role":        i.Role,
			"accept_url":  buildInviteActionURL(appURL, spaceInviteAcceptPath, token),
			"reject_url":  buildInviteActionURL(appURL, spaceInviteRejectPath, token),
			"app_url":     appURL,
		},
		Priority: notification.PriorityNormal,
	}, nil
}

func buildInviteActionURL(appBaseURL string, path string, token string) string {
	base := strings.TrimRight(strings.TrimSpace(appBaseURL), "/")
	query := "token=" + url.QueryEscape(token)
	if base == "" || base == "/" {
		return path + "?" + query
	}
	return base + path + "?" + query
}

func getSpaceNameForInviteEmail(ctx context.Context, spaceID string) (string, error) {
	var name string
	err := core.GetPool().QueryRow(ctx, "SELECT name FROM core.space WHERE id = $1 AND deleted_at IS NULL", spaceID).Scan(&name)
	if err != nil {
		return "", fmt.Errorf("get invite space name: %w", err)
	}
	return name, nil
}
