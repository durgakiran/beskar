package invite

import (
	"encoding/json"
	"errors"

	"github.com/durgakiran/beskar/core"
)

func validateInput(data []byte) (Invite, error) {
	var invite Invite
	err := json.Unmarshal(data, &invite)
	if err != nil {
		logger().Error(err.Error())
		return invite, err
	}
	if invite.Email == "" {
		return invite, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	if invite.Entity == "" {
		return invite, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	if invite.EntityId == "" {
		return invite, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	if invite.Role == "" {
		return invite, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	return invite, nil
}
