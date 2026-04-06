package space

import (
	"time"

	"github.com/google/uuid"
)

type Space struct {
	Id              uuid.UUID `json:"id" db:"id"`
	Name            string    `json:"name" db:"name"`
	Description     string    `json:"description" db:"description"`
	DateCreated     time.Time `json:"dateCreated" db:"date_created"`
	DateUpdated     time.Time `json:"dateUpdated" db:"date_updated"`
	CreatedBy       uuid.UUID `json:"createdBy" db:"user_id"`
	MemberCount     int       `json:"memberCount"`
	DocCount        int       `json:"docCount"`
	WhiteboardCount int       `json:"whiteboardCount"`
	UserRole        string    `json:"userRole"`
}

type SpaceListItem struct {
	Id              uuid.UUID `json:"id" db:"id"`
	Name            string    `json:"name" db:"name"`
	Description     string    `json:"description" db:"description"`
	DateUpdated     time.Time `json:"dateUpdated" db:"date_updated"`
	CreatedBy       uuid.UUID `json:"createdBy" db:"user_id"`
	MemberCount     int       `json:"memberCount"`
	DocCount        int       `json:"docCount"`
	WhiteboardCount int       `json:"whiteboardCount"`
	UserRole        string    `json:"userRole"`
}

type PageList struct {
	PageId   int64     `json:"pageId" db:"id"`
	OwnerId  uuid.UUID `json:"ownerId" db:"owner_id"`
	Title    string    `json:"title" db:"title"`
	ParentId int64     `json:"parentId" db:"parent_id"`
	Draft    int8      `json:"draft" db:"draft"`
	Type     string    `json:"type" db:"type"`
}

type User struct {
	Id    uuid.UUID `json:"id" db:"id"`
	Name  string    `json:"name" db:"name"`
	Role  string    `json:"role" db:"role"`
	Email string    `json:"email" db:"email"`
}
