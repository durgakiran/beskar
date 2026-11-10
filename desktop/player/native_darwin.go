//go:build darwin && cgo

package player

/*
#cgo LDFLAGS: -framework Cocoa -framework WebKit -framework QuartzCore
#include <stdbool.h>
#include <stdlib.h>
bool beskarShowPlayer(void *window,const char *id,const char *video,double x,double y,double width,double height,double cx,double cy,double cw,double ch,double vw,double vh);
void beskarHidePlayer(void *window,const char *id,bool destroy);
*/
import "C"
import "unsafe"

const supported = true

func show(window unsafe.Pointer, id, video string, f Frame) bool {
	key, code := C.CString(id), C.CString(video)
	defer C.free(unsafe.Pointer(key))
	defer C.free(unsafe.Pointer(code))
	return bool(C.beskarShowPlayer(window, key, code, C.double(f.X), C.double(f.Y), C.double(f.Width), C.double(f.Height), C.double(f.ClipX), C.double(f.ClipY), C.double(f.ClipWidth), C.double(f.ClipHeight), C.double(f.ViewportWidth), C.double(f.ViewportHeight)))
}
func hide(window unsafe.Pointer, id string, destroy bool) {
	key := C.CString(id)
	defer C.free(unsafe.Pointer(key))
	C.beskarHidePlayer(window, key, C.bool(destroy))
}
