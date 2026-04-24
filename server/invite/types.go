package invite

import (
	"database/sql"
	"time"

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
	Token     string     `json:"token" db:"token"`
	Name      string     `json:"name" db:"name"`
	CreatedAt *time.Time `json:"createdAt,omitempty" db:"created_at"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty" db:"updated_at"`
}

type InviteDBOV5 struct {
	InviteDBOV4
	SenderName string `json:"senderName"`
}

type InviteDetailsDBO struct {
	Entity    string         `db:"entity"`
	EntityId  string         `db:"entity_id"`
	SenderId  uuid.UUID      `db:"sender_id"`
	Status    sql.NullString `db:"status"`
	Email     string         `db:"email_id"`
	Role      string         `db:"role"`
	Token     string         `db:"token"`
	Name      string         `db:"name"`
	CreatedAt *time.Time     `db:"created_at"`
	UpdatedAt *time.Time     `db:"updated_at"`
}

type InviteDetailsResponse struct {
	Entity     string     `json:"entity"`
	EntityId   string     `json:"entityId"`
	SenderId   uuid.UUID  `json:"senderId"`
	SenderName string     `json:"senderName"`
	Name       string     `json:"name"`
	Role       string     `json:"role"`
	Token      string     `json:"token"`
	Status     *string    `json:"status"`
	CreatedAt  *time.Time `json:"createdAt,omitempty"`
	UpdatedAt  *time.Time `json:"updatedAt,omitempty"`
}

type InviteDecisionRequest struct {
	Token    string `json:"token"`
	Decision string `json:"decision"`
}

type InviteDecisionResponse struct {
	Status   string `json:"status"`
	Entity   string `json:"entity"`
	EntityId string `json:"entityId"`
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
	Entity    string         `json:"entity" db:"entity"`
	EntityId  string         `json:"entityId" db:"entity_id"`
	SenderId  uuid.UUID      `json:"senderId" db:"sender_id"`
	Status    sql.NullString `json:"status" db:"status"`
	Email     string         `json:"email" db:"email_id"`
	Role      string         `json:"role" db:"role"`
	CreatedAt *time.Time     `json:"createdAt,omitempty" db:"created_at"`
	UpdatedAt *time.Time     `json:"updatedAt,omitempty" db:"updated_at"`
}
