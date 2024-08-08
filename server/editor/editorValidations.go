package editor

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

func ValidateNewDraftDoc(data []byte) (InputDraftDocument, error) {
	var inputDoc InputDraftDocument
	err := json.Unmarshal(data, &inputDoc)
	if err != nil {
		fmt.Println(err.Error())
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
		fmt.Println(err.Error())
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
	space := GetSpace(spaceId)
	return space.UserId == userId
}
