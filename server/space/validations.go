package space

import (
	"encoding/json"
	"errors"

	"github.com/durgakiran/beskar/core"
)

func validateSpace(data []byte) (Space, error) {
	var space Space
	err := json.Unmarshal(data, &space)
	if err != nil {
		logger().Error(err.Error())
		return space, err
	}
	if space.Name == "" {
		return space, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	return space, nil
}
