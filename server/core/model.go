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

type UserInfo struct {
	Name       string `json:"name"`
	Username   string `json:"preferred_username"`
	Email      string `json:"email"`
	Id         string `json:"sub"`
	IsVerified bool   `json:"email_verified"`
}

type UserInfoOut struct {
	Name       string `json:"name"`
	Username   string `json:"username"`
	Email      string `json:"email"`
	Id         string `json:"id"`
	IsVerified bool   `json:"emailVerified"`
}
