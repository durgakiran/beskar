package core

type ErrorCode int32

const (
	ErrorCode_ERROR_CODE_UNSPECIFIED ErrorCode = 0

	// db
	ErrorCode_ERROR_CODE_CONNECTION_ISSUE ErrorCode = 1001
	ErrorCode_ERROR_WHILE_FETCHING_ROWS   ErrorCode = 1002
	ErrorCode_ERROR_WHILE_READING_ROWS    ErrorCode = 1003
	ErrorCode_ERROR_WHILE_INSERTING_ROWS  ErrorCode = 1004

	// permission
	ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE ErrorCode = 2001
	ErrorCode_ERROR_CODE_UNAUTHORIZED            ErrorCode = 2002
	ErrorCode_ERROR_CODE_MISSING_INPUT           ErrorCode = 2003

	// not found
	ErrorCode_ERROR_CODE_NO_DATA ErrorCode = 4001
)

var ErrorCode_name = map[ErrorCode]string{
	0:    "ERROR_CODE_UNSPECIFIED",
	1001: "ERROR_CODE_CONNECTION_ISSUE",
	1002: "ERROR_WHILE_FETCHING_ROWS",
	1003: "ERROR_WHILE_READING_ROWS",
	1004: "ERROR_WHILE_INSERTING_ROWS",
	2001: "ERROR_CODE_PERMISSION_SERVER_ISSUE",
	2002: "ERROR_CODE_UNAUTHORIZED",
	2003: "ERROR_CODE_MISSING_INPUT",
	4001: "ERROR_CODE_NO_DATA",
}

var ErrorName_Code = map[string]ErrorCode{
	"ERROR_CODE_UNSPECIFIED":             0,
	"ERROR_CODE_CONNECTION_ISSUE":        1001,
	"ERROR_WHILE_FETCHING_ROWS":          1002,
	"ERROR_WHILE_READING_ROWS":           1003,
	"ERROR_WHILE_INSERTING_ROWS":         1004,
	"ERROR_CODE_PERMISSION_SERVER_ISSUE": 2001,
	"ERROR_CODE_UNAUTHORIZED":            2002,
	"ERROR_CODE_MISSING_INPUT":           2003,
	"ERROR_CODE_NO_DATA":                 4001,
}

type Code uint32

const (
	UnAuthenticated Code = 16
	Forbidden       Code = 15
	Unavailable     Code = 14
	Internal        Code = 13
	NotFound        Code = 5
	Cancelled       Code = 1
	OK              Code = 0
)
