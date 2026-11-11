//go:build !beskar_dev || beskar_alpha

package config

// Alpha and production never consult the development environment variable.
func allowDevelopmentTLSException() bool { return false }
