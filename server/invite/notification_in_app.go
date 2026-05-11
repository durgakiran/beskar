package invite

import (
	"context"
	"fmt"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func spaceInviteCreatedEventKey(token string) string {
	return fmt.Sprintf("%s:%s", notification.NotificationTypeSpaceInviteCreated, token)
}

func (i Invite) emitSpaceInviteCreatedInApp(ctx context.Context, token string, sender core.UserInfo) error {
	if i.Entity != "space" || i.UserId == uuid.Nil {
		return nil
	}
	spaceID, err := uuid.Parse(i.EntityId)
	if err != nil {
		return err
	}
	actorID, err := uuid.Parse(sender.AId)
	if err != nil {
		return err
	}
	spaceName, err := getSpaceNameForInviteEmail(ctx, i.EntityId)
	if err != nil {
		return err
	}
	senderName := strings.TrimSpace(sender.Name)
	if senderName == "" {
		senderName = strings.TrimSpace(sender.Email)
	}
	if senderName == "" {
		senderName = "Someone"
	}
	recipientID := i.UserId
	return notification.NewService().Emit(ctx, notification.EmitNotificationRequest{
		EventKey: spaceInviteCreatedEventKey(token),
		Type:     notification.NotificationTypeSpaceInviteCreated,
		Category: notification.NotificationCategorySpaceInvite,
		Actor: notification.NotificationActor{
			UserID: actorID,
			Name:   senderName,
			Email:  sender.Email,
		},
		Recipients: []notification.NotificationRecipient{{
			UserID: &recipientID,
			Email:  i.Email,
			Name:   i.Email,
		}},
		Target: notification.NotificationTarget{
			Type:    notification.NotificationTargetInvite,
			ID:      token,
			SpaceID: &spaceID,
		},
		Title:          fmt.Sprintf("%s invited you to %s", senderName, spaceName),
		Body:           "Review the invite before choosing.",
		ActionRequired: true,
		Actions: []notification.NotificationAction{
			{Key: "decline", Label: "Decline", Method: "POST", URL: "/api/v1/invite/user/decision"},
			{Key: "accept", Label: "Accept", Method: "POST", URL: "/api/v1/invite/user/decision"},
		},
		Data: map[string]any{
			"token":      token,
			"space_id":   spaceID.String(),
			"space_name": spaceName,
			"role":       i.Role,
			"href":       buildInviteActionURL("", token, "accept"),
		},
		Channels: []string{notification.ChannelInApp},
	})
}

func emitSpaceInviteDecisionInApp(ctx context.Context, details InviteDetailsResponse, inviteeUserID string, inviteeEmail string, status string) {
	inviteeID, err := uuid.Parse(inviteeUserID)
	if err != nil {
		logger().Warn("failed to parse invitee id for notification", zap.Error(err))
		return
	}
	spaceID, err := uuid.Parse(details.EntityId)
	if details.Entity != "space" || err != nil {
		return
	}
	inviterID := details.SenderId
	inviteeName := strings.TrimSpace(inviteeEmail)
	if inviteeName == "" {
		inviteeName = "Someone"
	}

	service := notification.NewService()
	if err := service.ResolveByEventKey(ctx, spaceInviteCreatedEventKey(details.Token), &inviteeID); err != nil {
		logger().Warn("failed to resolve invite notification", zap.Error(err))
	}

	notificationType := notification.NotificationTypeSpaceInviteAccepted
	actionText := "accepted"
	if strings.EqualFold(status, STATUS_REJECTED) || strings.EqualFold(status, "rejected") {
		notificationType = notification.NotificationTypeSpaceInviteDeclined
		actionText = "declined"
	}

	eventKey := fmt.Sprintf("%s:%s:%s", notificationType, details.Token, inviterID.String())
	if err := service.Emit(ctx, notification.EmitNotificationRequest{
		EventKey: eventKey,
		Type:     notificationType,
		Category: notification.NotificationCategorySpaceMembership,
		Actor: notification.NotificationActor{
			UserID: inviteeID,
			Name:   inviteeName,
			Email:  inviteeEmail,
		},
		Recipients: []notification.NotificationRecipient{{
			UserID: &inviterID,
		}},
		Target: notification.NotificationTarget{
			Type:    notification.NotificationTargetSpace,
			ID:      details.EntityId,
			SpaceID: &spaceID,
		},
		Title: fmt.Sprintf("%s %s your invite to %s", inviteeName, actionText, details.Name),
		Body:  "Open space settings to review current members and pending invites.",
		Data: map[string]any{
			"token":      details.Token,
			"space_id":   details.EntityId,
			"space_name": details.Name,
			"href":       fmt.Sprintf("/space/%s/settings/invites", details.EntityId),
		},
		Channels: []string{notification.ChannelInApp},
	}); err != nil {
		logger().Warn("failed to emit invite decision notification", zap.Error(err))
	}
}
