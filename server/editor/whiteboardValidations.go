package editor

import (
	"encoding/json"
	"errors"

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

func ValidateWhiteboardUpdate(data []byte) (WhiteboardInput, error) {
	var inputDoc WhiteboardInput
	err := json.Unmarshal(data, &inputDoc)
	if err != nil {
		logger().Error(err.Error())
		return WhiteboardInput{}, err
	}

	return inputDoc, nil
}
