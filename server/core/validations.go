package core

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

func ValidateUserSpacePermissions(spaceId uuid.UUID, userId uuid.UUID, permission string) bool {
	cr, err := CheckPermission("space", spaceId.String(), "user", userId.String(), permission)
	if err != nil {
		Logger.Error(err.Error())
		return false
	}
	return cr
}

func ValidateUserPagePermission(pageId string, userId uuid.UUID, permission string) bool {
	cr, err := CheckPermission("page", pageId, "user", userId.String(), permission)
	if err != nil {
		Logger.Error(err.Error())
		return false
	}
	return cr
}

func ValidateUserEntityPermission(entity string, entityId string, userId uuid.UUID, permission string) bool {
	cr, err := CheckPermission(entity, entityId, "user", userId.String(), permission)
	if err != nil {
		Logger.Error(err.Error())
		return false
	}
	return cr
}

func ValidateSpaceMutable(spaceId uuid.UUID) error {
	type spaceState struct {
		ArchivedAt *string `db:"archived_at"`
		DeletedAt  *string `db:"deleted_at"`
	}

	var state spaceState
	err := GetPool().QueryRow(context.Background(), "SELECT archived_at::text, deleted_at::text FROM core.space WHERE id = $1", spaceId).
		Scan(&state.ArchivedAt, &state.DeletedAt)
	if err != nil {
		Logger.Error(err.Error())
		return err
	}
	if state.DeletedAt != nil {
		return errors.New("space has been deleted")
	}
	if state.ArchivedAt != nil {
		return errors.New("space is archived")
	}
	return nil
}
