package space

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
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

// A null parent means the space root. Require the field to avoid accidentally
// moving a page to the root when a client sends an incomplete request.
func validateMovePageRequest(data []byte) (MovePageRequest, error) {
	var body struct {
		ParentId     json.RawMessage `json:"parentId"`
		TargetPageId json.RawMessage `json:"targetPageId"`
		Placement    json.RawMessage `json:"placement"`
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&body); err != nil {
		return MovePageRequest{}, err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return MovePageRequest{}, errors.New("Expected one JSON object")
	}
	if len(body.ParentId) == 0 {
		return MovePageRequest{}, errors.New("parentId is required")
	}
	var parent *int64
	if err := json.Unmarshal(body.ParentId, &parent); err != nil {
		return MovePageRequest{}, err
	}
	if parent != nil && (*parent <= 0 || *parent > 9007199254740991) {
		return MovePageRequest{}, errors.New("Invalid parentId")
	}
	req := MovePageRequest{ParentId: parent}
	if len(body.TargetPageId) > 0 || len(body.Placement) > 0 {
		var target int64
		if err := json.Unmarshal(body.TargetPageId, &target); err != nil || target <= 0 || target > 9007199254740991 {
			return MovePageRequest{}, errors.New("Invalid targetPageId")
		}
		if err := json.Unmarshal(body.Placement, &req.Placement); err != nil || (req.Placement != "before" && req.Placement != "after") {
			return MovePageRequest{}, errors.New("Provide targetPageId and placement together")
		}
		req.TargetPageId = &target
	}
	return req, nil
}

func validateReorderPageRequest(data []byte) (ReorderPageRequest, error) {
	var req ReorderPageRequest
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return req, err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	if req.TargetPageId <= 0 || req.TargetPageId > 9007199254740991 || (req.Placement != "before" && req.Placement != "after") {
		return req, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	return req, nil
}
