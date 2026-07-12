package platform

import (
	"log"

	"github.com/gen2brain/beeep"
)

// NotificationService provides native OS notifications to the Wails frontend.
type NotificationService struct{}

// NewNotificationService creates a new NotificationService instance.
func NewNotificationService() *NotificationService {
	return &NotificationService{}
}

// Notify triggers a system notification with the given title and message.
// It returns an error string (empty if success) so the frontend can catch failures.
func (s *NotificationService) Notify(title, message string) string {
	log.Printf("[Notification] %s: %s", title, message)
	
	// Pass empty string for icon to use the default app icon or no icon.
	err := beeep.Notify(title, message, "")
	if err != nil {
		log.Printf("[Notification] Failed to send system notification: %v", err)
		return err.Error()
	}
	return ""
}
