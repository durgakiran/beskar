package core

// GetStatus - Get status code and message from error
func GetStatus(status string) Code {

	// If this wasn't a custom error, continue with your existing logic...
	code, ok := ErrorName_Code[status]
	if !ok {
		return Internal
	}
	switch {
	case code > 999 && code < 1999:
		return Internal
	case code > 1999 && code < 2999:
		return UnAuthenticated
	case code > 3999 && code < 4999:
		return NotFound
	case code > 4999 && code < 5999:
		return Internal
	default:
		return Internal
	}
}
