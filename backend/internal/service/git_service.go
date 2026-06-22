package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// GitFileStatus represents a single file's git status entry.
type GitFileStatus struct {
	Path     string `json:"path"`     // path relative to repo root
	Status   string `json:"status"`   // raw XY porcelain v1 code
	Category string `json:"category"` // modified / untracked / deleted / added / renamed
}

// GitRepoState is the full snapshot of a space's git repo, returned by State().
type GitRepoState struct {
	IsRepo          bool            `json:"is_repo"`
	Branch          string          `json:"branch"`
	Remote          string          `json:"remote"`           // remote name only, e.g. "origin"
	Upstream        string          `json:"upstream"`         // full upstream ref, e.g. "origin/main"; empty if none
	HasRemote       bool            `json:"has_remote"`
	HasUpstream     bool            `json:"has_upstream"`
	Ahead           int             `json:"ahead"`
	Behind          int             `json:"behind"`
	Files           []GitFileStatus `json:"files"`
	DirtyCount      int             `json:"dirty_count"`
	Error           string          `json:"error,omitempty"`
}

// GitSyncConfig holds the auto-commit configuration for a space.
type GitSyncConfig struct {
	Mode             string `json:"mode"`              // "off" | "on-save" | "scheduled"
	Action           string `json:"action"`            // "commit" | "commit-push" (auto-commit action)
	ScheduledSeconds int    `json:"scheduled_seconds"` // when mode == "scheduled"
	DebounceMs       int    `json:"debounce_ms"`       // when mode == "on-save"
}

// DefaultGitSyncConfig returns the default config (auto-commit off, commit-only).
func DefaultGitSyncConfig() GitSyncConfig {
	return GitSyncConfig{Mode: "off", Action: "commit", ScheduledSeconds: 300, DebounceMs: 3000}
}

// Sentinel errors so handlers can map to HTTP statuses without parsing strings.
var (
	ErrSpaceNotFound = errors.New("space not found")
	ErrNotAGitRepo   = errors.New("space is not a git repo")
	ErrNoRemote      = errors.New("no remote configured")
)

// GitService handles all git operations on space directories.
// Each operation is serialized per-space to avoid index lock races between
// auto-commit, manual commit, push, and pull.
type GitService struct {
	docsDir string
	mu      map[string]*sync.Mutex
	muMu    sync.Mutex

	// creds is optional; when nil, no per-space credential injection happens
	// and git uses the server's default SSH config / credential helper.
	creds *CredentialStore

	// onConfigChange is invoked from SetConfig so the auto-commit worker can
	// drop its cached config. Optional — nil when no worker is wired.
	onConfigChange func(slug string)
}

func NewGitService(docsDir string) *GitService {
	return &GitService{docsDir: docsDir, mu: make(map[string]*sync.Mutex)}
}

// SetCredentialStore wires the per-space credential store. Optional; call
// once at startup if credential management is desired.
func (s *GitService) SetCredentialStore(c *CredentialStore) {
	s.creds = c
}

// CredentialMeta returns the safe metadata for the space's stored credential.
// Returns zero-value meta (type="none") when no store is wired or no cred set.
func (s *GitService) CredentialMeta(slug string) CredentialMeta {
	if s.creds == nil {
		return CredentialMeta{Type: CredNone}
	}
	return s.creds.Get(slug)
}

// SetCredential stores (or clears) credentials for the space.
func (s *GitService) SetCredential(slug string, in CredentialInput) error {
	if s.creds == nil {
		return errors.New("credential storage not configured on the server")
	}
	return s.creds.Set(slug, in)
}

// DeleteCredential removes any stored credentials for the space.
func (s *GitService) DeleteCredential(slug string) error {
	if s.creds == nil {
		return nil
	}
	return s.creds.Delete(slug)
}

// SetOnConfigChange registers a callback fired after SetConfig writes. The
// auto-commit worker uses it to invalidate its cached config.
func (s *GitService) SetOnConfigChange(fn func(slug string)) {
	s.onConfigChange = fn
}

func (s *GitService) lockFor(spaceSlug string) *sync.Mutex {
	s.muMu.Lock()
	defer s.muMu.Unlock()
	m, ok := s.mu[spaceSlug]
	if !ok {
		m = &sync.Mutex{}
		s.mu[spaceSlug] = m
	}
	return m
}

// resolveSpacePath maps a space slug to an absolute directory path.
// Mirrors PageService.resolveSpaceDir: exact path first, then slugified scan.
func (s *GitService) resolveSpacePath(spaceSlug string) (string, bool) {
	exact := filepath.Join(s.docsDir, spaceSlug)
	if isDir(exact) {
		return exact, true
	}
	entries, err := os.ReadDir(s.docsDir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if slugify(e.Name()) == spaceSlug {
			return filepath.Join(s.docsDir, e.Name()), true
		}
	}
	return "", false
}

// --- Public API ---

// State reads the full git state. If the space dir isn't a git repo, IsRepo
// is false and the rest of the fields are empty.
func (s *GitService) State(spaceSlug string) (*GitRepoState, error) {
	spacePath, ok := s.resolveSpacePath(spaceSlug)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrSpaceNotFound, spaceSlug)
	}
	// Files is initialized to an empty slice (not nil) so JSON serialization
	// produces `[]` instead of `null`. The frontend's render path indexes into
	// Files unconditionally when IsRepo=true; a null would crash it. Even when
	// statusFiles errors below, we keep Files empty rather than nil.
	state := &GitRepoState{Files: []GitFileStatus{}}
	if !s.isRepoAt(spacePath) {
		return state, nil
	}
	state.IsRepo = true

	if out, err := s.gitForSlug(spaceSlug, spacePath, nil, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		state.Branch = strings.TrimSpace(out)
	}
	if out, err := s.gitForSlug(spaceSlug, spacePath, nil, "remote"); err == nil {
		remote := strings.TrimSpace(strings.Split(out, "\n")[0])
		state.Remote = remote
		state.HasRemote = remote != ""
	}
	if state.HasRemote && state.Branch != "" {
		// Upstream tracking branch (e.g. "origin/main"). @{u} resolves via
		// branch.<name>.merge config; fails silently when no upstream is set.
		if out, err := s.gitForSlug(spaceSlug, spacePath, nil, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"); err == nil {
			up := strings.TrimSpace(out)
			if up != "" && up != "HEAD" {
				state.Upstream = up
				state.HasUpstream = true
			}
		}
		// Don't fetch on every State() call — that would block every UI poll.
		// ahead/behind are computed from the last fetched refs; user-triggered
		// Push/Pull will refresh them. If the upstream ref doesn't exist yet
		// (no prior fetch/push), rev-list just fails and we report 0/0.
		if state.HasUpstream {
			if out, err := s.gitForSlug(spaceSlug, spacePath, nil, "rev-list", "--left-right", "--count", "HEAD...@{u}"); err == nil {
				parts := strings.Fields(out)
				if len(parts) == 2 {
					fmt.Sscanf(parts[0], "%d", &state.Ahead)
					fmt.Sscanf(parts[1], "%d", &state.Behind)
				}
			}
		}
	}

	files, err := s.statusFiles(spacePath)
	if err != nil {
		state.Error = err.Error()
		return state, nil
	}
	state.Files = files
	state.DirtyCount = len(files)
	return state, nil
}

func (s *GitService) statusFiles(spacePath string) ([]GitFileStatus, error) {
	out, err := s.git(spacePath, nil, "status", "--porcelain=v1", "-z")
	if err != nil {
		return nil, err
	}
	var files []GitFileStatus
	if out == "" {
		return files, nil
	}
	records := strings.Split(out, "\x00")
	for i := 0; i < len(records); i++ {
		rec := records[i]
		if len(rec) < 3 {
			continue
		}
		indexCode := rec[0]
		worktreeCode := rec[1]
		path := rec[3:]
		// Rename: following record is the original path — skip it.
		if indexCode == 'R' || worktreeCode == 'R' {
			if i+1 < len(records) {
				i++
			}
		}
		files = append(files, GitFileStatus{
			Path:     path,
			Status:   string(indexCode) + string(worktreeCode),
			Category: classifyStatus(indexCode, worktreeCode),
		})
	}
	return files, nil
}

func classifyStatus(index, worktree byte) string {
	if worktree == '?' && index == '?' {
		return "untracked"
	}
	if worktree == 'D' || index == 'D' {
		return "deleted"
	}
	if index == 'A' {
		return "added"
	}
	if index == 'R' || worktree == 'R' {
		return "renamed"
	}
	return "modified"
}

// Commit stages the supplied paths and creates a commit with the given message.
// Paths are validated to live inside the space directory. If `git add` fails
// mid-way, the index is reset so we don't leave partial stages behind.
func (s *GitService) Commit(spaceSlug, message string, paths []string) error {
	spacePath, ok := s.resolveSpacePath(spaceSlug)
	if !ok {
		return ErrSpaceNotFound
	}
	if strings.TrimSpace(message) == "" {
		return errors.New("commit message required")
	}
	if len(paths) == 0 {
		return errors.New("no files selected")
	}
	if err := validatePaths(spacePath, paths); err != nil {
		return err
	}

	s.lockFor(spaceSlug).Lock()
	defer s.lockFor(spaceSlug).Unlock()

	addArgs := append([]string{"add", "--"}, paths...)
	if _, err := s.gitForSlug(spaceSlug, spacePath, nil, addArgs...); err != nil {
		// Roll back any partially staged entries so the next commit doesn't
		// silently sweep them up.
		_, _ = s.gitForSlug(spaceSlug, spacePath, nil, "reset", "-q", "--mixed", "HEAD", "--")
		return err
	}
	_, err := s.gitForSlug(spaceSlug, spacePath, commitEnv(), "commit", "-m", message)
	return err
}

// Push pushes the current branch to its upstream (or origin).
func (s *GitService) Push(spaceSlug string) (string, error) {
	return s.withRemote(spaceSlug, func(spacePath string) (string, error) {
		return s.gitForSlug(spaceSlug, spacePath, nil, "push")
	})
}

// Pull fetches and merges from upstream.
func (s *GitService) Pull(spaceSlug string) (string, error) {
	return s.withRemote(spaceSlug, func(spacePath string) (string, error) {
		return s.gitForSlug(spaceSlug, spacePath, nil, "pull", "--no-edit")
	})
}

func (s *GitService) withRemote(spaceSlug string, fn func(spacePath string) (string, error)) (string, error) {
	spacePath, ok := s.resolveSpacePath(spaceSlug)
	if !ok {
		return "", ErrSpaceNotFound
	}
	s.lockFor(spaceSlug).Lock()
	defer s.lockFor(spaceSlug).Unlock()
	remote, err := s.gitForSlug(spaceSlug, spacePath, nil, "remote")
	if err != nil || strings.TrimSpace(remote) == "" {
		return "", ErrNoRemote
	}
	return fn(spacePath)
}

// CommitAll stages everything and commits. Used by the auto-commit worker.
// Silently returns nil if there's nothing to commit.
func (s *GitService) CommitAll(spaceSlug, message string) error {
	spacePath, ok := s.resolveSpacePath(spaceSlug)
	if !ok {
		return ErrSpaceNotFound
	}
	s.lockFor(spaceSlug).Lock()
	defer s.lockFor(spaceSlug).Unlock()

	dirty, err := s.gitForSlug(spaceSlug, spacePath, nil, "status", "--porcelain=v1")
	if err != nil {
		return err
	}
	if strings.TrimSpace(dirty) == "" {
		return nil
	}
	if _, err := s.gitForSlug(spaceSlug, spacePath, nil, "add", "-A"); err != nil {
		return err
	}
	if _, err := s.gitForSlug(spaceSlug, spacePath, commitEnv(), "commit", "-m", message); err != nil {
		// nothing-to-commit isn't an error for our caller
		if strings.Contains(err.Error(), "nothing to commit") ||
			strings.Contains(err.Error(), "no changes added") {
			return nil
		}
		return err
	}
	return nil
}

// IsRepo is a cheap check used by the frontend visibility gate.
func (s *GitService) IsRepo(spaceSlug string) bool {
	spacePath, ok := s.resolveSpacePath(spaceSlug)
	if !ok {
		return false
	}
	return s.isRepoAt(spacePath)
}

// --- Config (stored in .git/config under akmdlibrary.* namespace) ---

func (s *GitService) GetConfig(spaceSlug string) (GitSyncConfig, error) {
	cfg := DefaultGitSyncConfig()
	spacePath, ok := s.resolveSpacePath(spaceSlug)
	if !ok {
		return cfg, ErrSpaceNotFound
	}
	if !s.isRepoAt(spacePath) {
		return cfg, nil
	}
	if v, err := s.git(spacePath, nil, "config", "--get", "akmdlibrary.autocommit.mode"); err == nil {
		cfg.Mode = strings.TrimSpace(v)
	}
	if v, err := s.git(spacePath, nil, "config", "--get", "akmdlibrary.autocommit.action"); err == nil {
		a := strings.TrimSpace(v)
		if a == "commit" || a == "commit-push" {
			cfg.Action = a
		}
	}
	if v, err := s.git(spacePath, nil, "config", "--get", "akmdlibrary.autocommit.scheduledSeconds"); err == nil {
		var n int
		fmt.Sscanf(strings.TrimSpace(v), "%d", &n)
		if n > 0 {
			cfg.ScheduledSeconds = n
		}
	}
	if v, err := s.git(spacePath, nil, "config", "--get", "akmdlibrary.autocommit.debounceMs"); err == nil {
		var n int
		fmt.Sscanf(strings.TrimSpace(v), "%d", &n)
		if n > 0 {
			cfg.DebounceMs = n
		}
	}
	return cfg, nil
}

func (s *GitService) SetConfig(spaceSlug string, cfg GitSyncConfig) error {
	spacePath, ok := s.resolveSpacePath(spaceSlug)
	if !ok {
		return ErrSpaceNotFound
	}
	if !s.isRepoAt(spacePath) {
		return ErrNotAGitRepo
	}
	// Validate mode + bounds (mirror frontend min values).
	switch cfg.Mode {
	case "off", "on-save", "scheduled":
	default:
		return fmt.Errorf("invalid mode: %q", cfg.Mode)
	}
	switch cfg.Action {
	case "commit", "commit-push":
	default:
		return fmt.Errorf("invalid action: %q", cfg.Action)
	}
	if cfg.ScheduledSeconds < 30 {
		return fmt.Errorf("scheduled_seconds must be >= 30")
	}
	if cfg.DebounceMs < 500 {
		return fmt.Errorf("debounce_ms must be >= 500")
	}
	pairs := map[string]string{
		"akmdlibrary.autocommit.mode":             cfg.Mode,
		"akmdlibrary.autocommit.action":           cfg.Action,
		"akmdlibrary.autocommit.scheduledSeconds": fmt.Sprintf("%d", cfg.ScheduledSeconds),
		"akmdlibrary.autocommit.debounceMs":       fmt.Sprintf("%d", cfg.DebounceMs),
	}
	for k, v := range pairs {
		if _, err := s.git(spacePath, nil, "config", k, v); err != nil {
			return fmt.Errorf("set %s: %w", k, err)
		}
	}
	if s.onConfigChange != nil {
		s.onConfigChange(spaceSlug)
	}
	return nil
}

// --- helpers ---

func (s *GitService) isRepoAt(spacePath string) bool {
	_, err := s.git(spacePath, nil, "rev-parse", "--is-inside-work-tree")
	return err == nil
}

// git runs git with a 30s timeout. env overlays the parent env when non-nil.
// We force GIT_TERMINAL_PROMPT=0 and an empty ASKPASS so git NEVER blocks on
// interactive credential input — without this, a push to a remote that wants
// a password would hang the subprocess (it has no TTY) until the 30s timeout,
// producing a confusing error. With it, git fails fast with "Authentication
// failed" / "Permission denied", which SafePublicMessage maps to a clear hint.
var gitNoPromptEnv = []string{
	"GIT_TERMINAL_PROMPT=0",
	"GIT_ASKPASS=",
	"SSH_ASKPASS=",
}

// git runs git in dir with optional env overlays. dir must be the absolute
// space path. Use gitForSlug for slug-keyed calls so credentials get applied.
func (s *GitService) git(dir string, env []string, args ...string) (string, error) {
	return s.gitWithCreds(dir, nil, env, args...)
}

// gitForSlug runs git in the space dir, layering any stored credential env
// vars for that slug. Slug is the user-facing slug (not the resolved path);
// credentials are looked up by slug.
func (s *GitService) gitForSlug(slug, dir string, env []string, args ...string) (string, error) {
	var credEnv []string
	if s.creds != nil {
		credEnv = s.creds.EnvFor(slug)
	}
	return s.gitWithCreds(dir, credEnv, env, args...)
}

func (s *GitService) gitWithCreds(dir string, credEnv, env []string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	// Layering order (later wins): parent env → no-prompt defaults →
	// credential vars → caller-supplied (e.g. commit author identity).
	cmd.Env = append(os.Environ(), gitNoPromptEnv...)
	cmd.Env = append(cmd.Env, credEnv...)
	if env != nil {
		cmd.Env = append(cmd.Env, env...)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), &gitError{cmd: "git " + strings.Join(args, " "), out: string(out), err: err}
	}
	return string(out), nil
}

type gitError struct {
	cmd     string
	out     string
	err     error
	safeMsg string // user-facing message; if empty, callers should use a generic one
}

func (e *gitError) Error() string {
	// Internal log-friendly message: includes the command + trimmed stderr so
	// operators can debug. This is NOT what's returned to the HTTP client —
	// handlers map git errors to safe public messages.
	trimmed := strings.TrimSpace(e.out)
	if trimmed != "" {
		return fmt.Sprintf("%s failed: %s", e.cmd, trimmed)
	}
	return fmt.Sprintf("%s failed: %v", e.cmd, e.err)
}

// SafePublicMessage returns a non-sensitive message suitable for HTTP clients.
// It recognizes common git failures and maps them to a fixed string; otherwise
// passes through the actual git output (sanitized + truncated) so users can see
// WHY an operation failed instead of getting a useless generic error.
func (e *gitError) SafePublicMessage() string {
	if e.safeMsg != "" {
		return e.safeMsg
	}
	low := strings.ToLower(e.out)
	switch {
	case strings.Contains(low, "would be overwritten by merge"),
		strings.Contains(low, "your local changes"):
		return "local changes would be overwritten; commit or stash first"
	case strings.Contains(low, "merge conflict"),
		strings.Contains(low, "conflict"):
		return "merge conflict; resolve manually on the server"
	case strings.Contains(low, "permission denied"),
		strings.Contains(low, "could not read username"),
		strings.Contains(low, "authentication failed"),
		strings.Contains(low, "invalid username or password"),
		strings.Contains(low, "terminal prompt"),
		strings.Contains(low, "host key verification failed"),
		strings.Contains(low, "connection timed out"),
		strings.Contains(low, "could not resolve host"):
		return "remote authentication or network failed; check git credentials / SSH key / network on the server"
	case strings.Contains(low, "nothing to commit"),
		strings.Contains(low, "no changes added"):
		return "nothing to commit"
	case strings.Contains(low, "fatal: not a git repository"):
		return "directory is not a git repository"
	case strings.Contains(low, "couldn't find remote ref"),
		strings.Contains(low, "no such remote"),
		strings.Contains(low, "fetch first"):
		return "remote rejected the operation; pull first"
	}
	// Unknown failure — pass through the real git output so the user can
	// actually see what went wrong (e.g. "remote rejected" reasons, hook
	// failures, lock file issues). Sanitize + truncate first.
	trimmed := strings.TrimSpace(e.out)
	if trimmed == "" {
		return "git operation failed; see server logs"
	}
	return redactAndTruncate(trimmed)
}

// redactAndTruncate sanitizes raw git output before sending to the client.
// Redactions:
//   - Credentials embedded in URLs (https://user:pass@host → https://***@host)
//     so we never leak plaintext passwords even if a remote URL happens to
//     embed them in git's error output.
//
// Truncation keeps the HTTP response body manageable (clients render this in
// toast / inline UI).
func redactAndTruncate(s string) string {
	const max = 800
	// Match scheme://user:pass@ — credentials in URL. Replace user:pass with ***.
	re := regexp.MustCompile(`(https?|ssh|git)://[^/\s:@]+:[^/\s:@]+@`)
	s = re.ReplaceAllString(s, "$1://***:***@")
	if len(s) > max {
		s = s[:max] + "\n...(truncated)"
	}
	return s
}

// PublicGitError turns err into a user-safe message. If err is not a *gitError
// (e.g. it's one of our sentinels like ErrSpaceNotFound), it returns err.Error()
// unchanged (those messages are already safe).
func PublicGitError(err error) string {
	if err == nil {
		return ""
	}
	if ge, ok := err.(*gitError); ok {
		return ge.SafePublicMessage()
	}
	return err.Error()
}

// validatePaths ensures every path is relative, doesn't escape the space root
// (after resolving symlinks), and contains no control characters or other
// characters that could confuse argv parsing.
//
// Strict rules:
//   - Reject empty, ".", absolute paths, and any path that resolves outside
//     spacePath (via filepath.EvalSymlinks so symlink chains can't escape).
//   - Reject paths containing NUL, newline, carriage return, or backslash
//     (avoids git's pathspec parser surprises and cross-platform issues).
//   - Reject any path whose literal segments contain ".." — extra defense
//     alongside EvalSymlinks for cases where the target doesn't exist yet.
func validatePaths(spacePath string, paths []string) error {
	absRoot, err := filepath.Abs(spacePath)
	if err != nil {
		return fmt.Errorf("resolve space path: %w", err)
	}
	absRootEval, err := filepath.EvalSymlinks(absRoot)
	if err != nil {
		// If EvalSymlinks fails (e.g. dir doesn't exist), fall back to absRoot.
		absRootEval = absRoot
	}
	// Trusted prefix to compare against; trailing separator ensures we don't
	// match sibling directories that happen to share a name prefix.
	trustedPrefix := absRootEval
	if !strings.HasSuffix(trustedPrefix, string(filepath.Separator)) {
		trustedPrefix += string(filepath.Separator)
	}
	for _, p := range paths {
		if p == "" || p == "." {
			return fmt.Errorf("invalid path")
		}
		// Reject obviously hostile characters early.
		if strings.ContainsAny(p, "\x00\n\r\\") {
			return fmt.Errorf("invalid characters in path")
		}
		if filepath.IsAbs(p) {
			return fmt.Errorf("absolute path not allowed")
		}
		// Reject any ".." segment in the literal path — cheap, and covers
		// symlink targets that don't resolve because the file doesn't exist yet.
		for _, seg := range strings.Split(p, string(filepath.Separator)) {
			if seg == ".." {
				return fmt.Errorf("path escapes repo root")
			}
		}
		// Resolve the candidate against the space root and ensure it stays inside.
		candidate := filepath.Join(absRootEval, p)
		resolved, err := filepath.EvalSymlinks(candidate)
		if err != nil {
			// Target may not exist yet (new file). Use Clean on the literal path
			// and check the prefix — sufficient for not-yet-existing entries,
			// combined with the ".." segment check above.
			resolved = filepath.Clean(candidate)
		}
		// Resolve must equal absRootEval or live beneath it. Use a HasPrefix
		// check on the path+separator to avoid matching sibling dirs.
		if resolved != absRootEval && !strings.HasPrefix(resolved+string(filepath.Separator), trustedPrefix) {
			return fmt.Errorf("path escapes repo root")
		}
	}
	return nil
}

func commitEnv() []string {
	return []string{
		"GIT_AUTHOR_NAME=akmdlibrary",
		"GIT_AUTHOR_EMAIL=akmdlibrary@local",
		"GIT_COMMITTER_NAME=akmdlibrary",
		"GIT_COMMITTER_EMAIL=akmdlibrary@local",
	}
}

func isDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

var (
	slugNonAlnum = regexp.MustCompile("[^a-z0-9-]")
	slugMulti    = regexp.MustCompile("-+")
)

func slugify(name string) string {
	s := strings.ToLower(name)
	s = strings.ReplaceAll(s, " ", "-")
	s = slugNonAlnum.ReplaceAllString(s, "")
	s = slugMulti.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}
