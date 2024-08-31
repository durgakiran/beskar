package editor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	permify_payload "buf.build/gen/go/permifyco/permify/protocolbuffers/go/base/v1"
	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
)

func ValidateNewDraftDoc(data []byte) (InputDraftDocument, error) {
	var inputDoc InputDraftDocument
	err := json.Unmarshal(data, &inputDoc)
	if err != nil {
		logger().Error(fmt.Sprintf(err.Error()))
		return InputDraftDocument{}, err
	}

	if inputDoc.Title == "" {
		return InputDraftDocument{}, errors.New("invalid document: No title present")
	}

	if inputDoc.SpaceId == uuid.Nil {
		return InputDraftDocument{}, errors.New("invalid document: Invalid space id")
	}

	return inputDoc, nil
}

func ValidateNewDoc(data []byte) (InputDocument, error) {
	var inputDoc InputDocument
	err := json.Unmarshal(data, &inputDoc)
	if err != nil {
		logger().Error(err.Error())
		return InputDocument{}, err
	}

	if inputDoc.Title == "" {
		return InputDocument{}, errors.New("invalid document: No title present")
	}

	if inputDoc.SpaceId == uuid.Nil {
		return InputDocument{}, errors.New("invalid document: Invalid space id")
	}

	return inputDoc, nil
}

func ValidateUserSpacePermissions(spaceId uuid.UUID, userId uuid.UUID) bool {
	client := core.GetPermifyInstance()
	cr, err := client.Permission.Check(
		context.Background(),
		&permify_payload.PermissionCheckRequest{
			TenantId: "t1",
			Metadata: &permify_payload.PermissionCheckRequestMetadata{
				SchemaVersion: "",
				SnapToken:     "",
				Depth:         20,
			},
			Entity: &permify_payload.Entity{
				Type: "space",
				Id:   spaceId.String(),
			},
			Permission: "view",
			Subject: &permify_payload.Subject{
				Type:     "user",
				Id:       userId.String(),
				Relation: "",
			},
		},
	)
	if err != nil {
		logger().Error(err.Error())
		return false
	}
	return cr.Can == permify_payload.CheckResult_CHECK_RESULT_ALLOWED
}
