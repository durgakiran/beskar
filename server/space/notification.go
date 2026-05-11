package space

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/durgakiran/beskar/notification"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

func emitSpaceMemberAddedNotification(ctx context.Context, space Space, actor User, recipient User, role string) {
	if recipient.Id == uuid.Nil {
		return
	}
	recipientID := recipient.Id
	if err := notification.NewService().Emit(ctx, notification.EmitNotificationRequest{
		EventKey: fmt.Sprintf("%s:%s:%s", notification.NotificationTypeSpaceMemberAdded, space.Id.String(), recipientID.String()),
		Type:     notification.NotificationTypeSpaceMemberAdded,
		Category: notification.NotificationCategorySpaceMembership,
		Actor:    notificationActor(actor),
		Recipients: []notification.NotificationRecipient{{
			UserID: &recipientID,
			Email:  recipient.Email,
			Name:   recipient.Name,
		}},
		Target: notification.NotificationTarget{
			Type:    notification.NotificationTargetSpace,
			ID:      space.Id.String(),
			SpaceID: &space.Id,
		},
		Title: fmt.Sprintf("You were added to %s", space.Name),
		Body:  fmt.Sprintf("Your role is %s.", normalizeRole(role)),
		Data: map[string]any{
			"space_id":   space.Id.String(),
			"space_name": space.Name,
			"role":       normalizeRole(role),
			"href":       fmt.Sprintf("/space/%s", space.Id.String()),
		},
		Channels: []string{notification.ChannelInApp},
	}); err != nil {
		logger().Warn("failed to emit member added notification", zap.Error(err))
	}
}

func emitSpaceMemberRoleChangedNotification(ctx context.Context, space Space, actor User, recipient User, oldRole string, newRole string, changedAt time.Time) {
	recipientID := recipient.Id
	if err := notification.NewService().Emit(ctx, notification.EmitNotificationRequest{
		EventKey: fmt.Sprintf("%s:%s:%s:%s:%d", notification.NotificationTypeSpaceMemberRoleChanged, space.Id.String(), recipientID.String(), normalizeRole(newRole), changedAt.UnixNano()),
		Type:     notification.NotificationTypeSpaceMemberRoleChanged,
		Category: notification.NotificationCategorySpaceMembership,
		Actor:    notificationActor(actor),
		Recipients: []notification.NotificationRecipient{{
			UserID: &recipientID,
			Email:  recipient.Email,
			Name:   recipient.Name,
		}},
		Target: notification.NotificationTarget{
			Type:    notification.NotificationTargetSpace,
			ID:      space.Id.String(),
			SpaceID: &space.Id,
		},
		Title: fmt.Sprintf("Your role in %s changed", space.Name),
		Body:  fmt.Sprintf("Your role changed from %s to %s.", normalizeRole(oldRole), normalizeRole(newRole)),
		Data: map[string]any{
			"space_id":   space.Id.String(),
			"space_name": space.Name,
			"old_role":   normalizeRole(oldRole),
			"new_role":   normalizeRole(newRole),
			"href":       fmt.Sprintf("/space/%s", space.Id.String()),
		},
		Channels:  []string{notification.ChannelInApp},
		CreatedAt: &changedAt,
	}); err != nil {
		logger().Warn("failed to emit member role changed notification", zap.Error(err))
	}
}

func emitSpaceMemberRemovedNotification(ctx context.Context, space Space, actor User, recipient User, removedAt time.Time) {
	recipientID := recipient.Id
	if err := notification.NewService().Emit(ctx, notification.EmitNotificationRequest{
		EventKey: fmt.Sprintf("%s:%s:%s:%d", notification.NotificationTypeSpaceMemberRemoved, space.Id.String(), recipientID.String(), removedAt.UnixNano()),
		Type:     notification.NotificationTypeSpaceMemberRemoved,
		Category: notification.NotificationCategorySpaceMembership,
		Actor:    notificationActor(actor),
		Recipients: []notification.NotificationRecipient{{
			UserID: &recipientID,
			Email:  recipient.Email,
			Name:   recipient.Name,
		}},
		Target: notification.NotificationTarget{
			Type: notification.NotificationTargetAccount,
			ID:   recipientID.String(),
		},
		Title: fmt.Sprintf("You no longer have access to %s", space.Name),
		Body:  "Your membership for this space was removed.",
		Data: map[string]any{
			"space_id":   space.Id.String(),
			"space_name": space.Name,
			"href":       "/space",
		},
		Channels:  []string{notification.ChannelInApp},
		CreatedAt: &removedAt,
	}); err != nil {
		logger().Warn("failed to emit member removed notification", zap.Error(err))
	}
}

func emitSpaceLifecycleNotification(ctx context.Context, notificationType string, space Space, actor User, recipients []User, happenedAt time.Time) {
	title := ""
	body := ""
	target := notification.NotificationTarget{Type: notification.NotificationTargetSpace, ID: space.Id.String(), SpaceID: &space.Id}
	href := fmt.Sprintf("/space/%s", space.Id.String())
	switch notificationType {
	case notification.NotificationTypeSpaceArchived:
		title = fmt.Sprintf("%s was archived", space.Name)
		body = "This space is now read-only."
	case notification.NotificationTypeSpaceUnarchived:
		title = fmt.Sprintf("%s was unarchived", space.Name)
		body = "Editing is available again."
	case notification.NotificationTypeSpaceDeleted:
		title = fmt.Sprintf("%s was deleted", space.Name)
		body = "This space is no longer available."
		target = notification.NotificationTarget{Type: notification.NotificationTargetAccount, ID: space.Id.String()}
		href = "/space"
	default:
		return
	}

	eventKey := fmt.Sprintf("%s:%s:%d", notificationType, space.Id.String(), happenedAt.UnixNano())
	for _, recipient := range recipients {
		if recipient.Id == actor.Id {
			continue
		}
		recipientID := recipient.Id
		key := eventKey
		if notificationType == notification.NotificationTypeSpaceDeleted {
			key = fmt.Sprintf("%s:%s", eventKey, recipientID.String())
		}
		if err := notification.NewService().Emit(ctx, notification.EmitNotificationRequest{
			EventKey: key,
			Type:     notificationType,
			Category: notification.NotificationCategorySpaceLifecycle,
			Actor:    notificationActor(actor),
			Recipients: []notification.NotificationRecipient{{
				UserID: &recipientID,
				Email:  recipient.Email,
				Name:   recipient.Name,
			}},
			Target: target,
			Title:  title,
			Body:   body,
			Data: map[string]any{
				"space_id":   space.Id.String(),
				"space_name": space.Name,
				"href":       href,
			},
			Channels:  []string{notification.ChannelInApp},
			CreatedAt: &happenedAt,
		}); err != nil {
			logger().Warn("failed to emit lifecycle notification", zap.String("type", notificationType), zap.Error(err))
		}
	}
}

func notificationActor(user User) notification.NotificationActor {
	name := strings.TrimSpace(user.Name)
	if name == "" {
		name = strings.TrimSpace(user.Email)
	}
	return notification.NotificationActor{
		UserID: user.Id,
		Name:   name,
		Email:  user.Email,
	}
}

func userByID(users []User, id uuid.UUID) (User, bool) {
	for _, user := range users {
		if user.Id == id {
			return user, true
		}
	}
	return User{Id: id, Name: id.String()}, false
}
