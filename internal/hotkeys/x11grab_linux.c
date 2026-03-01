// Custom X11 hotkey grab with pipe-based cancellation.
// Unlike the golang.design/x/hotkey library's waitHotkey, this implementation
// returns immediately when the cancel fd becomes readable.

//go:build linux

#include <stdint.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/select.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>

extern void encountyKeyDown(uintptr_t handle);

int encountyDisplayTest() {
	Display* d = XOpenDisplay(0);
	if (d == NULL) return -1;
	XCloseDisplay(d);
	return 0;
}

// grabAndListen grabs a key and listens for KeyPress events.
// Returns when cancelFd becomes readable (cancellation).
void grabAndListen(uintptr_t handle, unsigned int mod, int keysym, int cancelFd) {
	Display* d = XOpenDisplay(0);
	if (d == NULL) return;

	int keycode = XKeysymToKeycode(d, (KeySym)keysym);
	if (keycode == 0) {
		// Keysym not present on this keyboard layout — nothing to grab.
		XCloseDisplay(d);
		return;
	}
	Window root = DefaultRootWindow(d);

	// Grab with all combinations of NumLock (Mod2Mask) and CapsLock (LockMask)
	// so hotkeys fire regardless of those lock-key states.
	unsigned int locks[] = { 0, Mod2Mask, LockMask, Mod2Mask|LockMask };
	for (int i = 0; i < 4; i++)
		XGrabKey(d, keycode, mod|locks[i], root, False, GrabModeAsync, GrabModeAsync);
	XSelectInput(d, root, KeyPressMask);
	XFlush(d);

	int x11fd = ConnectionNumber(d);
	fd_set rfds;
	struct timeval tv;

	for (;;) {
		// Drain pending X events first.
		while (XPending(d) > 0) {
			XEvent ev;
			XNextEvent(d, &ev);
			if (ev.type == KeyPress) {
				encountyKeyDown(handle);
			}
		}

		// Wait for X events or cancellation.
		FD_ZERO(&rfds);
		FD_SET(x11fd, &rfds);
		FD_SET(cancelFd, &rfds);
		int maxfd = (x11fd > cancelFd) ? x11fd : cancelFd;
		tv.tv_sec = 0;
		tv.tv_usec = 100000; // 100ms timeout

		int ret = select(maxfd + 1, &rfds, NULL, NULL, &tv);
		if (ret < 0) break; // error

		if (FD_ISSET(cancelFd, &rfds)) {
			break; // cancellation
		}
		// x11fd ready: loop to drain events
	}

	for (int i = 0; i < 4; i++)
		XUngrabKey(d, keycode, mod|locks[i], root);
	XCloseDisplay(d);
}
