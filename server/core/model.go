package core

type ResponseType struct {
	Data   interface{} `json:"data"`
	Status string      `json:"status,omitempty"`
}

type ErrorResponseType struct {
	Status string       `json:"status,omitempty"`
	Error  ResponseMeta `json:"error"`
}

type ResponseMeta struct {
	AppStatusCode int    `json:"code,omitempty"`
	Message       string `json:"message,omitempty"`
	ErrorDetail   string `json:"detail,omitempty"`
}

const SUCCESS = "success"
const FAILURE = "FAILED"
