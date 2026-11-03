package config

// Set with -ldflags for signed macOS production releases. This is a public
// signing identifier, never a secret or a runtime environment override.
var ReleaseTeamID string
