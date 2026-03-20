//go:build windows

// capture_windows.go implements native window enumeration and capture on Windows
// using the Win32 GDI and user32 APIs via golang.org/x/sys/windows.
package detector

import (
	"fmt"
	"image"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")

	procEnumWindows          = user32.NewProc("EnumWindows")
	procGetWindowTextW       = user32.NewProc("GetWindowTextW")
	procGetWindowTextLengthW = user32.NewProc("GetWindowTextLengthW")
	procIsWindowVisible      = user32.NewProc("IsWindowVisible")
	procIsIconic             = user32.NewProc("IsIconic")
	procGetDesktopWindow     = user32.NewProc("GetDesktopWindow")
	procGetClassNameW        = user32.NewProc("GetClassNameW")
	procGetWindowRect        = user32.NewProc("GetWindowRect")
	procGetWindowDC          = user32.NewProc("GetWindowDC")
	procReleaseDC            = user32.NewProc("ReleaseDC")

	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procBitBlt                 = gdi32.NewProc("BitBlt")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
	procGetDIBits              = gdi32.NewProc("GetDIBits")
)

// SRCCOPY is the BitBlt raster-operation code for a straight source copy.
const srccopy = 0x00CC0020

// rect is the Win32 RECT structure used by GetWindowRect.
type rect struct {
	Left, Top, Right, Bottom int32
}

// bitmapInfoHeader is the Win32 BITMAPINFOHEADER structure for GetDIBits.
type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// WindowInfo describes a visible, titled top-level window on Windows.
type WindowInfo struct {
	HWND  uintptr `json:"hwnd"`
	Title string  `json:"title"`
	Class string  `json:"class"`
	W     int     `json:"w"`
	H     int     `json:"h"`
}

// ListWindows returns all visible, titled, non-minimized top-level windows
// on the current desktop, excluding the desktop window itself.
func ListWindows() []WindowInfo {
	desktopHWND, _, _ := procGetDesktopWindow.Call()

	var results []WindowInfo
	cb := windows.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		if hwnd == desktopHWND {
			return 1 // continue
		}
		visible, _, _ := procIsWindowVisible.Call(hwnd)
		if visible == 0 {
			return 1
		}
		iconic, _, _ := procIsIconic.Call(hwnd)
		if iconic != 0 {
			return 1
		}
		titleLen, _, _ := procGetWindowTextLengthW.Call(hwnd)
		if titleLen == 0 {
			return 1
		}

		buf := make([]uint16, titleLen+1)
		procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), titleLen+1)
		title := windows.UTF16ToString(buf)
		if title == "" {
			return 1
		}

		classBuf := make([]uint16, 256)
		procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&classBuf[0])), 256)
		class := windows.UTF16ToString(classBuf)

		var r rect
		procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
		w := int(r.Right - r.Left)
		h := int(r.Bottom - r.Top)

		results = append(results, WindowInfo{
			HWND:  hwnd,
			Title: title,
			Class: class,
			W:     w,
			H:     h,
		})
		return 1 // continue enumeration
	})
	procEnumWindows.Call(cb, 0)
	return results
}

// CaptureWindow captures the contents of the window identified by hwnd and
// returns it as an image.RGBA. All GDI resources are released before returning.
func CaptureWindow(hwnd uintptr) (image.Image, error) {
	var r rect
	ret, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ret == 0 {
		return nil, fmt.Errorf("GetWindowRect failed for hwnd %d", hwnd)
	}
	w := int(r.Right - r.Left)
	h := int(r.Bottom - r.Top)
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("window has zero or negative dimensions: %dx%d", w, h)
	}

	hdcWindow, _, _ := procGetWindowDC.Call(hwnd)
	if hdcWindow == 0 {
		return nil, fmt.Errorf("GetWindowDC failed for hwnd %d", hwnd)
	}
	defer procReleaseDC.Call(hwnd, hdcWindow)

	hdcMem, _, _ := procCreateCompatibleDC.Call(hdcWindow)
	if hdcMem == 0 {
		return nil, fmt.Errorf("CreateCompatibleDC failed")
	}
	defer procDeleteDC.Call(hdcMem)

	hBitmap, _, _ := procCreateCompatibleBitmap.Call(hdcWindow, uintptr(w), uintptr(h))
	if hBitmap == 0 {
		return nil, fmt.Errorf("CreateCompatibleBitmap failed")
	}
	defer procDeleteObject.Call(hBitmap)

	old, _, _ := procSelectObject.Call(hdcMem, hBitmap)
	if old == 0 {
		return nil, fmt.Errorf("SelectObject failed")
	}

	ret, _, _ = procBitBlt.Call(hdcMem, 0, 0, uintptr(w), uintptr(h), hdcWindow, 0, 0, srccopy)
	if ret == 0 {
		return nil, fmt.Errorf("BitBlt failed")
	}

	// Retrieve pixel data via GetDIBits (bottom-up BGR → top-down RGBA).
	bmi := bitmapInfoHeader{
		Size:     uint32(unsafe.Sizeof(bitmapInfoHeader{})),
		Width:    int32(w),
		Height:   -int32(h), // negative = top-down
		Planes:   1,
		BitCount: 32,
	}
	pixels := make([]byte, w*h*4)
	ret, _, _ = procGetDIBits.Call(
		hdcMem, hBitmap, 0, uintptr(h),
		uintptr(unsafe.Pointer(&pixels[0])),
		uintptr(unsafe.Pointer(&bmi)),
		0, // DIB_RGB_COLORS
	)
	if ret == 0 {
		return nil, fmt.Errorf("GetDIBits failed")
	}

	// Convert BGRA to RGBA in-place.
	for i := 0; i < len(pixels); i += 4 {
		pixels[i], pixels[i+2] = pixels[i+2], pixels[i]
		pixels[i+3] = 255
	}

	img := &image.RGBA{
		Pix:    pixels,
		Stride: w * 4,
		Rect:   image.Rect(0, 0, w, h),
	}
	return img, nil
}
