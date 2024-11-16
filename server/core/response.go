package core

import (
	"net/http"

	"github.com/go-chi/render"
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

func NewFailedResponse(code int, status string, message string, details string) *ErrorResponseType {
	return &ErrorResponseType{
		Status: FAILURE,
		Error: ResponseMeta{
			AppStatusCode: code,
			Message:       message,
			ErrorDetail:   details,
		},
	}
}

func SendFailedReponse(w http.ResponseWriter, r *http.Request, code int, message string) {
	status, statusCode := GetStatus(message)
	if code == 0 {
		code = statusCode
	}
	messageString := SUCCESS
	if code > 399 || code < 200 {
		messageString = FAILURE
	}
	render.Status(r, code)
	render.Render(w, r, NewFailedResponse(int(status), messageString, FAILURE, message))
}

func SendSuccessResponse(w http.ResponseWriter, r *http.Request, code int, data interface{}) {
	render.Status(r, code)
	render.Render(w, r, NewSucessResponse(SUCCESS, data))
}
