//go:build beskar_alpha && beskar_dev

package config

// Mixed policies must fail compilation rather than produce an insecure alpha.
var _ = ERROR_beskar_alpha_and_beskar_dev_are_mutually_exclusive
