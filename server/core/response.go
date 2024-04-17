package core

import (
	"net/http"
)

func (rd *ResponseType) Render(w http.ResponseWriter, r *http.Request) error {
	return nil
}

func NewSucessResponse(status string, data interface{}) *ResponseType {
	return &ResponseType{
		Status: status,
		Data:   data,
	}
}

func (e *ErrorResponseType) Render(w http.ResponseWriter, r *http.Request) error {
	return nil
}

func NewFailedResponse(code int, message string, details string) *ErrorResponseType {
	return &ErrorResponseType{
		Status: FAILURE,
		Error: ResponseMeta{
			AppStatusCode: code,
			Message:       message,
			ErrorDetail:   details,
		},
	}
}
