package editor

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

func ValidateWhiteboardCreate(data []byte) (WhiteboardInput, error) {
	var inputDoc WhiteboardInput
	err := json.Unmarshal(data, &inputDoc)
	if err != nil {
		logger().Error(err.Error())
		return WhiteboardInput{}, err
	}

	if inputDoc.Title == "" {
		return WhiteboardInput{}, errors.New("invalid whiteboard: No title present")
	}

	if inputDoc.SpaceId == uuid.Nil {
		return WhiteboardInput{}, errors.New("invalid whiteboard: Invalid space id")
	}

	return inputDoc, nil
}

func ValidateWhiteboardCheckpoint(data []byte) (WhiteboardCheckpointInput, error) {
	var input WhiteboardCheckpointInput
	if err := json.Unmarshal(data, &input); err != nil {
		return WhiteboardCheckpointInput{}, err
	}
	if input.DraftId <= 0 || input.TransactionSequence < 0 {
		return WhiteboardCheckpointInput{}, errors.New("invalid whiteboard checkpoint identity")
	}
	if strings.TrimSpace(input.ExpectedRevision) == "" || strings.TrimSpace(input.ClientId) == "" || strings.TrimSpace(input.RequestId) == "" {
		return WhiteboardCheckpointInput{}, errors.New("missing whiteboard checkpoint precondition or request identity")
	}
	if len(input.ExpectedRevision) > 32 || len(input.ClientId) > 128 || len(input.RequestId) > 128 {
		return WhiteboardCheckpointInput{}, errors.New("whiteboard checkpoint identity exceeds its size limit")
	}
	digest := fmt.Sprintf("sha256:%x", sha256.Sum256(input.Data))
	if input.StateDigest != digest {
		return WhiteboardCheckpointInput{}, errors.New("whiteboard checkpoint digest does not match decoded data")
	}
	return input, nil
}

func ValidateWhiteboardUpdate(data []byte) (WhiteboardInput, error) {
	var inputDoc WhiteboardInput
	err := json.Unmarshal(data, &inputDoc)
	if err != nil {
		logger().Error(err.Error())
		return WhiteboardInput{}, err
	}

	return inputDoc, nil
}

func ValidateWhiteboardPublish(data []byte) (WhiteboardPublishInput, error) {
	var input WhiteboardPublishInput
	if err := json.Unmarshal(data, &input); err != nil {
		return WhiteboardPublishInput{}, err
	}
	expectedRevision, err := strconv.ParseInt(input.ExpectedDraftRevision, 10, 64)
	if err != nil || expectedRevision < 0 || input.DraftId <= 0 {
		return WhiteboardPublishInput{}, errors.New("invalid whiteboard publish identity or revision")
	}
	if strings.TrimSpace(input.ClientId) == "" || strings.TrimSpace(input.RequestId) == "" {
		return WhiteboardPublishInput{}, errors.New("missing whiteboard publish request identity")
	}
	if len(input.ExpectedDraftRevision) > 32 || len(input.ClientId) > 128 || len(input.RequestId) > 128 || len(input.PreviewAssetName) > 512 {
		return WhiteboardPublishInput{}, errors.New("whiteboard publish identity exceeds its size limit")
	}
	digest := fmt.Sprintf("sha256:%x", sha256.Sum256(input.Data))
	if input.Checkpoint.StateDigest != digest || input.Checkpoint.TransactionSequence < 0 || input.Checkpoint.ServerUpdateSequence < 0 {
		return WhiteboardPublishInput{}, errors.New("whiteboard publish checkpoint does not match decoded data")
	}
	return input, nil
}
