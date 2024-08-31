package core

import "github.com/google/uuid"

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
