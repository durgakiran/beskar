package invite

import (
	"database/sql"

	"github.com/google/uuid"
)

type Invite struct {
	UserId   uuid.UUID `json:"userId"`
	Entity   string    `json:"entity"`
	EntityId string    `json:"entityId"`
	Token    string    `json:"token"`
	SenderId uuid.UUID `json:"senderId"`
	Status   string    `json:"status"`
}

type InviteDBO struct {
	Entity   string         `json:"entity" db:"entity"`
	EntityId string         `json:"entityId" db:"entity_id"`
	SenderId uuid.UUID      `json:"senderId" db:"sender_id"`
	Status   sql.NullString `json:"status" db:"status"`
}

type InviteDBOV2 struct {
	Entity   string         `json:"entity" db:"entity"`
	EntityId string         `json:"entityId" db:"entity_id"`
	UserId   uuid.UUID      `json:"senderId" db:"user_id"`
	Status   sql.NullString `json:"status" db:"status"`
}

type InviteInput struct {
	UserId   uuid.UUID
	Entity   string
	Entityid string
}
