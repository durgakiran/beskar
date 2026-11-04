//go:build !darwin || !cgo

package security

import "unsafe"

// Other WebViews require their own before-navigation integration. Do not claim
// native navigation enforcement on those platforms until implemented/tested.
func InstallNavigationGuard(_ unsafe.Pointer) bool { return false }
