package space

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/durgakiran/beskar/core"
)

func validateSpace(data []byte) (Space, error) {
	var space Space
	err := json.Unmarshal(data, &space)
	if err != nil {
		logger().Error(err.Error())
		return space, err
	}
	space.Name = strings.TrimSpace(space.Name)
	space.Description = strings.TrimSpace(space.Description)
	if space.Name == "" || space.Description == "" {
		return space, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	return space, nil
}
