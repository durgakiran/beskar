package invite

import (
	"encoding/json"
	"errors"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
)

func validateInput(data []byte) (Invite, error) {
	var invite Invite
	err := json.Unmarshal(data, &invite)
	if err != nil {
		logger().Error(err.Error())
		return invite, err
	}
	if invite.UserId == uuid.Nil {
		return invite, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	if invite.Entity == "" {
		return invite, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	if invite.EntityId == "" {
		return invite, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	return invite, nil
}
