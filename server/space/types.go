package space

import (
	"time"

	"github.com/google/uuid"
)

type Space struct {
	Id          uuid.UUID `json:"id" db:"id"`
	Name        string    `json:"name" db:"name"`
	DateCreated time.Time `json:"dateCreated" db:"date_created"`
	DateUpdated time.Time `json:"dateUpdated" db:"date_updated"`
	CreatedBy   uuid.UUID `json:"createdBy" db:"user_id"`
}
