// sync_refresh_test.go tests the throttle and decision logic of the
// background PokéAPI refresh with fake checks, so no network is involved.
package server

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// fakeRefresh records which steps of a pokeAPIRefresh ran.
type fakeRefresh struct {
	checks, gamesSynced, speciesSynced int
	stampAtFirstCheck                  bool
}

// newFakeRefresh builds a pokeAPIRefresh at now whose checks return the given
// results and whose syncs only count invocations.
func newFakeRefresh(stampPath string, now time.Time, games, species bool, checkErr error) (pokeAPIRefresh, *fakeRefresh) {
	f := &fakeRefresh{}
	check := func(outdated bool) func() (bool, error) {
		return func() (bool, error) {
			if f.checks == 0 {
				_, f.stampAtFirstCheck = readRefreshStamp(stampPath)
			}
			f.checks++
			return outdated, checkErr
		}
	}
	return pokeAPIRefresh{
		stampPath:       stampPath,
		now:             func() time.Time { return now },
		gamesOutdated:   check(games),
		speciesOutdated: check(species),
		syncGames:       func() { f.gamesSynced++ },
		syncSpecies:     func() { f.speciesSynced++ },
	}, f
}

func writeStamp(t *testing.T, path string, at time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(at.UTC().Format(time.RFC3339)), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRefreshSkipsWithinInterval(t *testing.T) {
	path := filepath.Join(t.TempDir(), refreshStampFile)
	now := time.Date(2027, 11, 20, 12, 0, 0, 0, time.UTC)
	writeStamp(t, path, now.Add(-23*time.Hour))

	r, f := newFakeRefresh(path, now, true, true, nil)
	if r.run() {
		t.Error("run should report it was throttled")
	}
	if f.checks != 0 || f.gamesSynced != 0 || f.speciesSynced != 0 {
		t.Errorf("throttled run made calls: %+v", f)
	}
}

func TestRefreshRunsWhenStampMissingOrStale(t *testing.T) {
	now := time.Date(2027, 11, 20, 12, 0, 0, 0, time.UTC)
	for name, setup := range map[string]func(string){
		"missing": func(string) {},
		"stale":   func(p string) { writeStamp(t, p, now.Add(-25*time.Hour)) },
		"garbage": func(p string) { _ = os.WriteFile(p, []byte("not a time"), 0o644) },
		"future":  func(p string) { writeStamp(t, p, now.Add(48*time.Hour)) },
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), refreshStampFile)
			setup(path)

			r, f := newFakeRefresh(path, now, false, false, nil)
			if !r.run() {
				t.Fatal("run should not be throttled")
			}
			if f.checks != 2 {
				t.Errorf("checks = %d, want 2", f.checks)
			}
			if !f.stampAtFirstCheck {
				t.Error("the attempt must be recorded before the first request")
			}
			if last, ok := readRefreshStamp(path); !ok || !last.Equal(now) {
				t.Errorf("stamp = %v (ok=%v), want %v", last, ok, now)
			}
			if f.gamesSynced != 0 || f.speciesSynced != 0 {
				t.Errorf("up-to-date data must not be synced: %+v", f)
			}
		})
	}
}

func TestRefreshSyncsOnlyOutdatedSide(t *testing.T) {
	now := time.Date(2027, 11, 20, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		games, species bool
	}{{true, false}, {false, true}, {true, true}} {
		r, f := newFakeRefresh(filepath.Join(t.TempDir(), refreshStampFile), now, tc.games, tc.species, nil)
		r.run()
		if (f.gamesSynced == 1) != tc.games || (f.speciesSynced == 1) != tc.species {
			t.Errorf("games=%v species=%v: synced %+v", tc.games, tc.species, f)
		}
	}
}

func TestRefreshCheckErrorSyncsNothing(t *testing.T) {
	path := filepath.Join(t.TempDir(), refreshStampFile)
	now := time.Date(2027, 11, 20, 12, 0, 0, 0, time.UTC)

	r, f := newFakeRefresh(path, now, true, true, errors.New("offline"))
	r.run()
	if f.gamesSynced != 0 || f.speciesSynced != 0 {
		t.Errorf("failed checks must not sync: %+v", f)
	}
	// The failed attempt still counts, so the next launch is throttled.
	r2, f2 := newFakeRefresh(path, now.Add(time.Hour), true, true, nil)
	if r2.run() || f2.checks != 0 {
		t.Error("a failed attempt must still throttle the next launch")
	}
}

func TestRefreshSkipsWhenStampUnwritable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing-dir", refreshStampFile)
	r, f := newFakeRefresh(path, time.Now(), true, true, nil)
	if r.run() || f.checks != 0 {
		t.Error("without a persisted stamp the refresh must not hit the network")
	}
}

func TestRefreshIfOutdatedSkipsWithoutDB(t *testing.T) {
	srv := newTestServer(t)
	srv.refreshIfOutdated()
	// The slot must be free again (or never taken).
	if !srv.TryStartSync() {
		t.Fatal("sync slot leaked")
	}
	srv.FinishSync()
}

func TestTryStartSyncIsExclusive(t *testing.T) {
	srv := newTestServer(t)
	if !srv.TryStartSync() {
		t.Fatal("slot should be free")
	}
	defer srv.FinishSync()
	if srv.TryStartSync() {
		t.Error("second TryStartSync must fail while the slot is held")
	}
}
