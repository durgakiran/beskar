//go:build !beskar_dev

package config

// The production policy never consults the development environment variable.
func allowDevelopmentTLSException() bool { return false }
