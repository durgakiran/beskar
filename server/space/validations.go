package space

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
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
	if space.Name == "" {
		return space, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	return space, nil
}

func normalizeIncomingRole(role string) string {
	role = strings.TrimSpace(strings.ToLower(role))
	switch role {
	case "commentor":
		return "commenter"
	default:
		return role
	}
}

func isValidMemberRole(role string) bool {
	switch normalizeIncomingRole(role) {
	case "admin", "editor", "commenter", "viewer":
		return true
	default:
		return false
	}
}

func validateAddSpaceMembers(data []byte) (AddSpaceMembersRequest, error) {
	var req AddSpaceMembersRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return req, err
	}
	if len(req.Members) == 0 {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	for i := range req.Members {
		req.Members[i].UserId = strings.TrimSpace(req.Members[i].UserId)
		req.Members[i].Role = normalizeIncomingRole(req.Members[i].Role)
		if _, err := uuid.Parse(req.Members[i].UserId); err != nil {
			return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		}
		if !isValidMemberRole(req.Members[i].Role) {
			return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		}
	}
	return req, nil
}

func validateChangeSpaceMemberRole(data []byte) (ChangeSpaceMemberRoleRequest, error) {
	var req ChangeSpaceMemberRoleRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return req, err
	}
	req.UserId = strings.TrimSpace(req.UserId)
	req.Role = normalizeIncomingRole(req.Role)
	if _, err := uuid.Parse(req.UserId); err != nil {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	if !isValidMemberRole(req.Role) {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	return req, nil
}

func validateRemoveSpaceMember(data []byte) (RemoveSpaceMemberRequest, error) {
	var req RemoveSpaceMemberRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return req, err
	}
	req.UserId = strings.TrimSpace(req.UserId)
	if _, err := uuid.Parse(req.UserId); err != nil {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	return req, nil
}

func validateMemberCandidateSearch(data []byte) (MemberCandidateSearchRequest, error) {
	var req MemberCandidateSearchRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return req, err
	}
	req.Query = strings.TrimSpace(req.Query)
	if req.Limit == 0 {
		req.Limit = 10
	}
	if req.Limit > 50 {
		req.Limit = 50
	}
	for i := range req.Emails {
		req.Emails[i] = strings.TrimSpace(strings.ToLower(req.Emails[i]))
	}
	if req.Query == "" && len(req.Emails) == 0 {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	return req, nil
}

func validateTransferOwnership(data []byte) (TransferOwnershipRequest, error) {
	var req TransferOwnershipRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return req, err
	}
	req.NewOwnerUserId = strings.TrimSpace(req.NewOwnerUserId)
	if _, err := uuid.Parse(req.NewOwnerUserId); err != nil {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	return req, nil
}

func validateDeleteSpaceRequest(data []byte) (DeleteSpaceRequest, error) {
	var req DeleteSpaceRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return req, err
	}
	req.ConfirmName = strings.TrimSpace(req.ConfirmName)
	if req.ConfirmName == "" {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_MISSING_INPUT])
	}
	return req, nil
}
