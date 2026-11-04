//go:build !darwin || !cgo

package player

import "unsafe"

const supported = false

func show(_ unsafe.Pointer, _, _ string, _ Frame) bool { return false }
func hide(_ unsafe.Pointer, _ string, _ bool)          {}
