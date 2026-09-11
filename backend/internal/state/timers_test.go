// timers_test.go covers the timer readings derived from a hunt's stored
// start timestamp and accumulated total.
package state

import (
	"testing"
	"time"
)

// TestTimerElapsedMs verifies that a stopped hunt reports its accumulated total
// unchanged and a running one adds the segment since it was started.
func TestTimerElapsedMs(t *testing.T) {
	stopped := Pokemon{TimerAccumulatedMs: 90_000}
	if got := TimerElapsedMs(stopped); got != 90_000 {
		t.Errorf("stopped timer = %d, want 90000", got)
	}

	startedAt := time.Now().Add(-2 * time.Second)
	running := Pokemon{TimerAccumulatedMs: 90_000, TimerStartedAt: &startedAt}
	got := TimerElapsedMs(running)
	if got < 91_900 || got > 93_000 {
		t.Errorf("running timer = %d, want roughly 92000", got)
	}
}
