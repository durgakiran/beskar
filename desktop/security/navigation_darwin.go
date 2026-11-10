//go:build darwin && cgo

package security

/*
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#include <stdbool.h>
#include <stdlib.h>
bool beskarTrustedMainURL(const char *raw);
bool beskarInstallNavigationGuard(void *window);
*/
import "C"
import "unsafe"

// InstallNavigationGuard must run on the Cocoa main thread after window creation.
func InstallNavigationGuard(window unsafe.Pointer) bool {
	return bool(C.beskarInstallNavigationGuard(window))
}

func trustedMainURL(raw string) bool {
	value := C.CString(raw)
	defer C.free(unsafe.Pointer(value))
	return bool(C.beskarTrustedMainURL(value))
}
