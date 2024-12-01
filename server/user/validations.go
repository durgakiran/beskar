package user

import (
	"encoding/json"
	"errors"

	"github.com/durgakiran/beskar/core"
)

func validateInput(data []byte) (SearchUser, error) {
	var user SearchUser
	err := json.Unmarshal(data, &user)
	if err != nil {
		core.Logger.Error(err.Error())
		return user, err
	}
	if user.Search == "" {
		return user, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	return user, nil
}
