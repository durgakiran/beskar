package invite

import (
	"encoding/json"
	"errors"
	"net/mail"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
)

func normalizeInviteRelation(role string) (string, error) {
	switch role {
	case "admin", "editor", "viewer", "commentor":
		return role, nil
	case "commenter":
		return "commentor", nil
	default:
		return "", errors.New("invalid invitation role")
	}
}

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
	invite.Email = strings.ToLower(strings.TrimSpace(invite.Email))
	address, err := mail.ParseAddress(invite.Email)
	if err != nil || address.Address != invite.Email {
		return invite, errors.New("invalid invitation email")
	}
	if invite.Entity != "space" {
		return invite, errors.New("invalid invitation entity")
	}
	if _, err := uuid.Parse(invite.EntityId); err != nil {
		return invite, errors.New("invalid space id")
	}
	invite.Role, err = normalizeInviteRelation(invite.Role)
	if err != nil {
		return invite, err
	}
	return invite, nil
}
