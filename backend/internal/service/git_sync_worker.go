package service

import (
	"log"
	"sync"
	"sync/atomic"
	"time"
)

// GitSyncWorker runs auto-commit for spaces that opt in.
// Two modes can be enabled independently:
//   - on-save:    MarkDirty(slug) starts (or restarts) a debounce timer;
//                 when it fires, a single commit captures all writes in the window.
//   - scheduled:  a ticker commits every N seconds if there are pending changes.
//
// Failures are logged but never bubble up to callers (file saves must not be
// blocked by git issues).
type GitSyncWorker struct {
	git *GitService

	// dirty marks which spaces have pending writes that may need auto-commit.
	// Keyed by space slug, value is the last MarkDirty timestamp.
	dirty   map[string]time.Time
	dirtyMu sync.Mutex

	// timers holds active debounce timers per slug so we can cancel on restart.
	timers   map[string]*time.Timer
	timersMu sync.Mutex

	// cfgCache avoids hitting `git config` on every save. Invalidate by slug
	// via InvalidateConfig (call from SetConfig) or by TTL.
	cfgCache   map[string]cachedConfig
	cfgCacheMu sync.Mutex

	// gitFeatureEnabled returns false when the space has feature_flags.git
	// disabled. Optional; nil means "all enabled". Injected from main.go to
	// avoid a circular import with SpaceService.
	gitFeatureEnabled func(slug string) bool

	stopping atomic.Bool // set when Stop is called; commitNow checks it
	stop     chan struct{}
	done     chan struct{}
}

type cachedConfig struct {
	cfg       GitSyncConfig
	fetchedAt time.Time
}

const configCacheTTL = 30 * time.Second

// NewGitSyncWorker constructs the worker. Call Start to launch background loops.
func NewGitSyncWorker(git *GitService) *GitSyncWorker {
	return &GitSyncWorker{
		git:      git,
		dirty:    make(map[string]time.Time),
		timers:   make(map[string]*time.Timer),
		cfgCache: make(map[string]cachedConfig),
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

// SetGitFeatureProbe injects a callback the worker consults before committing.
// Returning false causes commitNow and MarkDirty to skip the space entirely.
// Injected from main.go to avoid a circular import with SpaceService.
func (w *GitSyncWorker) SetGitFeatureProbe(f func(slug string) bool) {
	w.gitFeatureEnabled = f
}

func (w *GitSyncWorker) Start() {
	go w.scheduledLoop()
}

// Stop signals the scheduled loop and debounce timers to exit and blocks until
// the loop has actually stopped. This prevents in-flight git commits from
// getting torn down mid-way when the server shuts down.
func (w *GitSyncWorker) Stop() {
	if !w.stopping.CompareAndSwap(false, true) {
		return // already stopped
	}
	close(w.stop)
	<-w.done

	// Cancel any pending debounce timers.
	w.timersMu.Lock()
	for _, t := range w.timers {
		t.Stop()
	}
	w.timers = make(map[string]*time.Timer)
	w.timersMu.Unlock()
}

// InvalidateConfig clears the cached config for a slug. Call this whenever
// SetConfig writes new values.
func (w *GitSyncWorker) InvalidateConfig(slug string) {
	w.cfgCacheMu.Lock()
	delete(w.cfgCache, slug)
	w.cfgCacheMu.Unlock()
}

// getConfig returns the cached config or fetches it on miss.
func (w *GitSyncWorker) getConfig(slug string) GitSyncConfig {
	w.cfgCacheMu.Lock()
	if c, ok := w.cfgCache[slug]; ok && time.Since(c.fetchedAt) < configCacheTTL {
		w.cfgCacheMu.Unlock()
		return c.cfg
	}
	w.cfgCacheMu.Unlock()

	cfg, err := w.git.GetConfig(slug)
	if err != nil {
		return DefaultGitSyncConfig()
	}

	w.cfgCacheMu.Lock()
	w.cfgCache[slug] = cachedConfig{cfg: cfg, fetchedAt: time.Now()}
	w.cfgCacheMu.Unlock()
	return cfg
}

// MarkDirty notifies the worker that space `slug` has pending writes.
// Non-blocking and best-effort: we record the timestamp (for scheduled mode)
// and (re)start a debounce timer if on-save is enabled. We do NOT call git
// here — the config lookup goes through the cache so this stays cheap.
func (w *GitSyncWorker) MarkDirty(slug string) {
	if w.stopping.Load() {
		return
	}
	if w.gitFeatureEnabled != nil && !w.gitFeatureEnabled(slug) {
		return
	}

	w.dirtyMu.Lock()
	w.dirty[slug] = time.Now()
	w.dirtyMu.Unlock()

	cfg := w.getConfig(slug)
	if cfg.Mode != "on-save" {
		return // on-save not enabled — leave it for scheduled / manual
	}
	debounce := time.Duration(cfg.DebounceMs) * time.Millisecond
	if debounce <= 0 {
		debounce = 3 * time.Second
	}

	// (Re)start the debounce timer for this slug.
	w.timersMu.Lock()
	defer w.timersMu.Unlock()
	if t, ok := w.timers[slug]; ok {
		t.Stop()
	}
	w.timers[slug] = time.AfterFunc(debounce, func() {
		w.commitNow(slug, "on-save")
	})
}

// commitNow runs a single auto-commit. Clears dirty markers first (avoids
// retry storms), then runs CommitAll under the per-space git lock. If the
// space's action is "commit-push", follows up with a Push; push failures are
// logged but don't affect the already-successful commit.
func (w *GitSyncWorker) commitNow(slug, reason string) {
	if w.stopping.Load() {
		return
	}
	if w.gitFeatureEnabled != nil && !w.gitFeatureEnabled(slug) {
		return
	}

	w.dirtyMu.Lock()
	delete(w.dirty, slug)
	w.dirtyMu.Unlock()

	w.timersMu.Lock()
	delete(w.timers, slug)
	w.timersMu.Unlock()

	if err := w.git.CommitAll(slug, autoCommitMessage(reason)); err != nil {
		log.Printf("[gitsync] auto-commit failed for %s (%s): %v", slug, reason, err)
		return
	}

	// Optional follow-up push. Re-read config (cached) so config changes apply
	// on the next tick instead of waiting for the dirty window to close.
	cfg := w.getConfig(slug)
	if cfg.Action != "commit-push" {
		return
	}
	if _, err := w.git.Push(slug); err != nil {
		// Don't return err — the commit already succeeded. Logged for operators.
		log.Printf("[gitsync] auto-push after commit failed for %s (%s): %v", slug, reason, err)
	}
}

func autoCommitMessage(reason string) string {
	switch reason {
	case "on-save":
		return "[akmdlibrary] auto-commit (on-save)"
	case "scheduled":
		return "[akmdlibrary] auto-commit (scheduled) at " + time.Now().Format(time.RFC3339)
	default:
		return "[akmdlibrary] auto-commit"
	}
}

// scheduledLoop scans known dirty spaces every 10s and commits if their
// configured scheduled interval has elapsed since the last MarkDirty.
func (w *GitSyncWorker) scheduledLoop() {
	defer close(w.done)
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-w.stop:
			return
		case <-ticker.C:
			w.tickScheduled()
		}
	}
}

func (w *GitSyncWorker) tickScheduled() {
	// Snapshot dirty slugs under the lock; git ops happen after unlock.
	w.dirtyMu.Lock()
	type pending struct {
		slug       string
		lastChange time.Time
	}
	var todo []pending
	for slug, last := range w.dirty {
		todo = append(todo, pending{slug, last})
	}
	w.dirtyMu.Unlock()

	now := time.Now()
	for _, p := range todo {
		// Cheap config read (cached). Skip spaces where scheduled mode isn't on.
		cfg := w.getConfig(p.slug)
		if cfg.Mode != "scheduled" {
			continue
		}
		interval := time.Duration(cfg.ScheduledSeconds) * time.Second
		if interval <= 0 {
			interval = 5 * time.Minute
		}
		if now.Sub(p.lastChange) < interval {
			continue
		}
		w.commitNow(p.slug, "scheduled")
	}
}
