package invite

import (
	"database/sql"

	"github.com/google/uuid"
)

type Invite struct {
	UserId   uuid.UUID `json:"userId,omitempty"`
	Entity   string    `json:"entity"`
	EntityId string    `json:"entityId"`
	Token    string    `json:"token"`
	SenderId uuid.UUID `json:"senderId"`
	Status   string    `json:"status"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
}

type InviteDBO struct {
	Entity   string         `json:"entity" db:"entity"`
	EntityId string         `json:"entityId" db:"entity_id"`
	SenderId uuid.UUID      `json:"senderId" db:"sender_id"`
	Status   sql.NullString `json:"status" db:"status"`
	Role     string         `json:"role" db:"role"`
}

type InviteDBOV2 struct {
	Entity   string         `json:"entity" db:"entity"`
	EntityId string         `json:"entityId" db:"entity_id"`
	UserId   uuid.UUID      `json:"senderId" db:"user_id"`
	Status   sql.NullString `json:"status" db:"status"`
}

type InviteDBOV4 struct {
	InviteDBOV3
	Token string `json:"token" db:"token"`
	Name  string `json:"name" db:"name"`
}

type InviteDBOV5 struct {
	InviteDBOV4
	SenderName string `json:"senderName"`
}

type User struct {
	UserId string `json:"userId"`
	Name   string `json:"name"`
	Email  string `json:"email"`
}

type UserInvites struct {
	Invites []InviteDBOV5 `json:"invites"`
}

type InviteInput struct {
	UserId   uuid.UUID
	Entity   string
	Entityid string
}

type InviteDBOV3 struct {
	Entity   string         `json:"entity" db:"entity"`
	EntityId string         `json:"entityId" db:"entity_id"`
	SenderId uuid.UUID      `json:"senderId" db:"sender_id"`
	Status   sql.NullString `json:"status" db:"status"`
	Email    string         `json:"email" db:"email_id"`
	Role     string         `json:"role" db:"role"`
}
