//go:build desktop && darwin

package main

/*
#cgo darwin LDFLAGS: -framework Cocoa
#include "native_titlebar_darwin.h"
*/
import "C"

func installNativeTitleBarDrag() {
	C.akmdInstallTitleBarDrag(40, 78)
}
