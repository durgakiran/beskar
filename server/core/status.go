package core

import "net/http"

// GetStatus - Get status code and message from error
func GetStatus(status string) (Code, int) {

	// If this wasn't a custom error, continue with your existing logic...
	code, ok := ErrorName_Code[status]
	if !ok {
		return Internal, http.StatusInternalServerError
	}
	switch {
	case code > 999 && code < 1999:
		return Internal, http.StatusInternalServerError
	case code > 1999 && code < 2999:
		return UnAuthenticated, http.StatusForbidden
	case code > 3999 && code < 4999:
		return NotFound, http.StatusOK
	case code > 4999 && code < 5999:
		return Internal, http.StatusInternalServerError
	default:
		return Internal, http.StatusInternalServerError
	}
}
