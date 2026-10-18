package app

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/alwaysking/akmdlibrary/internal/handler"
	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/repository"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/alwaysking/akmdlibrary/internal/service/claude"
)

type Config struct {
	BindAddr     string
	Port         string
	DocsDir      string
	DataDir      string
	JWTSecret    string
	FrontendDist string
	DesktopMode  bool
}

type App struct {
	config        Config
	db            *repository.DB
	gitSyncWorker *service.GitSyncWorker
	handler       http.Handler
}

func NewFromEnv() (*App, error) {
	cfg := Config{
		BindAddr:     getEnv("BIND_ADDR", ""),
		Port:         getEnv("PORT", "8080"),
		DocsDir:      getEnv("DOCS_DIR", "/app/docs"),
		DataDir:      getEnv("DATA_DIR", "/app/data"),
		JWTSecret:    getEnv("JWT_SECRET", "dev-secret-change-me"),
		FrontendDist: getEnv("FRONTEND_DIST", "/app/html"),
		DesktopMode:  getEnv("AKMDL_DESKTOP", "") == "1",
	}
	return New(cfg)
}

func New(cfg Config) (*App, error) {
	docsDir := cfg.DocsDir
	dataDir := cfg.DataDir
	frontendDist := cfg.FrontendDist

	// Ensure directories exist
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}
	uploadDir := filepath.Join(dataDir, "uploads")
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return nil, err
	}
	iconDir := filepath.Join(dataDir, "icons")
	if err := os.MkdirAll(iconDir, 0755); err != nil {
		return nil, err
	}
	coverDir := filepath.Join(dataDir, "covers")
	if err := os.MkdirAll(coverDir, 0755); err != nil {
		return nil, err
	}
	siteDir := filepath.Join(dataDir, "site")
	if err := os.MkdirAll(siteDir, 0755); err != nil {
		return nil, err
	}

	// Initialize database
	db, err := repository.NewDB(dataDir)
	if err != nil {
		return nil, err
	}
	application := &App{config: cfg, db: db}
	success := false
	defer func() {
		if !success {
			_ = application.Close()
		}
	}()

	// Initialize repositories
	userRepo := repository.NewUserRepository(db)
	spaceRepo := repository.NewSpaceRepository(db)
	memberRepo := repository.NewMemberRepository(db)
	prefRepo := repository.NewPreferenceRepository(db)
	siteSettingRepo := repository.NewSiteSettingRepository(db)
	bookmarkRepo := repository.NewBookmarkRepository(db.DB)

	// Initialize services
	authService := service.NewAuthService(userRepo, cfg.JWTSecret)
	userService := service.NewUserService(userRepo, authService)
	gitService := service.NewGitService(docsDir)
	gitService.SetCredentialStore(service.NewCredentialStore(filepath.Join(dataDir, "git_credentials")))
	gitSyncWorker := service.NewGitSyncWorker(gitService)
	// When config changes, invalidate the worker's cache so new auto-commit
	// settings apply immediately instead of after the TTL.
	gitService.SetOnConfigChange(gitSyncWorker.InvalidateConfig)
	gitSyncWorker.Start()
	application.gitSyncWorker = gitSyncWorker
	pageService := service.NewPageService(docsDir)
	pageService.SetGitSyncWorker(gitSyncWorker)
	spaceService := service.NewSpaceService(spaceRepo, memberRepo, pageService, docsDir)
	personalService := service.NewPersonalService(userRepo, spaceRepo, memberRepo, pageService, docsDir)
	spaceService.SetGitSyncWorker(gitSyncWorker)
	// Inject feature-flag probe so the worker skips spaces with git disabled.
	// Must run after spaceService is constructed to avoid a circular import.
	gitSyncWorker.SetGitFeatureProbe(func(slug string) bool {
		space, err := spaceService.GetBySlug(slug)
		if err != nil {
			return false
		}
		return space.ParseFeatureFlags().Git
	})
	prefService := service.NewPreferenceService(prefRepo)
	siteSettingService := service.NewSiteSettingService(siteSettingRepo)
	// Claude config store
	claudeConfigStore := claude.NewConfigStore(dataDir, siteSettingRepo)
	if err := claudeConfigStore.EnsureDefaults(); err != nil {
		log.Printf("Warning: failed to init claude config: %v", err)
	}
	claudeManager := claude.NewManager(claudeConfigStore, memberRepo, spaceRepo, pageService, authService, docsDir)
	bookmarkService := service.NewBookmarkService(bookmarkRepo)
	searchService := service.NewSearchService(docsDir)
	databaseService := service.NewDatabaseService(docsDir)
	databaseService.SetGitSyncWorker(gitSyncWorker)
	pageService.SetDatabaseTrashRestorer(databaseService.RestoreTrashedRow)

	// Sync spaces from filesystem on startup
	if err := spaceService.SyncFromFS(); err != nil {
		log.Printf("Warning: failed to sync spaces from filesystem: %v", err)
	}

	// Migrate page IDs from integer to UUID (one-time)
	if err := pageService.MigrateToUUIDs(); err != nil {
		log.Printf("Warning: failed to migrate page IDs to UUID: %v", err)
	}

	// Initialize handlers
	authHandler := handler.NewAuthHandler(authService)
	desktopHandler := handler.NewDesktopHandler(authService)
	userHandler := handler.NewUserHandler(userService)
	spaceHandler := handler.NewSpaceHandler(spaceService, authService, cfg.DesktopMode)
	pageHandler := handler.NewPageHandler(pageService, spaceService, authService)
	uploadHandler := handler.NewUploadHandler(pageService, uploadDir, iconDir, coverDir)
	prefHandler := handler.NewPreferenceHandler(prefService)
	personalHandler := handler.NewPersonalHandler(personalService)
	siteSettingHandler := handler.NewSiteSettingHandler(siteSettingService, siteDir)
	bookmarkHandler := handler.NewBookmarkHandler(bookmarkService)
	claudeHandler := handler.NewClaudeHandler(claudeConfigStore, claudeManager)
	unsplashHandler := handler.NewUnsplashHandler(prefService)
	gitHandler := handler.NewGitHandler(gitService, spaceService)
	searchHandler := handler.NewSearchHandler(searchService, spaceService)
	filesHandler := handler.NewFilesHandler(docsDir, spaceService)
	syncedBlockHandler := handler.NewSyncedBlockHandler(pageService, spaceService)
	databaseHandler := handler.NewDatabaseHandler(databaseService, spaceService)

	// Initialize middleware
	authMiddleware := middleware.NewAuthMiddleware(authService)
	featureFlagMiddleware := middleware.NewFeatureFlagMiddleware(spaceService)

	// Router
	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(pageDebugRequestLogger)
	r.Use(middleware.ErrorLogging)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Public routes
	r.Get("/api/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	r.Get("/api/app-info", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"version":        Version,
			"build_time":     BuildTime,
			"schema_version": repository.CurrentSchemaVersion,
			"desktop":        cfg.DesktopMode,
		})
	})
	r.Post("/api/auth/login", authHandler.Login)
	r.Post("/api/auth/refresh", authHandler.Refresh)
	r.Post("/api/auth/logout", authHandler.Logout)
	r.Get("/api/site-settings", siteSettingHandler.Get)
	// Claude WebSocket（独立鉴权——浏览器 WS 不能用 Authorization header）
	r.Get("/api/spaces/{slug}/claude/ws", claudeHandler.ChatWS)
	// Claude 附件上传（multipart，5MB 上限，鉴权同 WS：query param ?token=）
	r.Post("/api/spaces/{slug}/claude/attachments", claudeHandler.UploadAttachment)

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware.RequireAuth)

		if cfg.DesktopMode {
			r.Post("/api/desktop/choose-folder", desktopHandler.ChooseFolder)
		}

		r.Get("/api/auth/me", authHandler.Me)
		r.Put("/api/auth/profile", authHandler.UpdateProfile)
		r.Put("/api/auth/password", authHandler.ChangePassword)

		// Preferences
		r.Get("/api/user/preferences", prefHandler.Get)
		r.Put("/api/user/preferences", prefHandler.Update)

		// Personal workspace (per-user files under docs/.personal-<uuid>/)
		r.Get("/api/personal", personalHandler.Overview)
		r.Post("/api/personal/todos", personalHandler.CreateTodo)
		r.Patch("/api/personal/todos/{index}", personalHandler.UpdateTodo)
		r.Delete("/api/personal/todos/{index}", personalHandler.DeleteTodo)
		r.Post("/api/personal/notes", personalHandler.CreateNote)
		r.Delete("/api/personal/notes/{id}", personalHandler.DeleteNote)

		// Spaces
		r.Get("/api/spaces", spaceHandler.List)
		r.Get("/api/spaces/{slug}", spaceHandler.Get)
		r.Post("/api/spaces", spaceHandler.Create)
		r.Put("/api/spaces/{slug}", spaceHandler.Update)
		r.Delete("/api/spaces/{slug}", spaceHandler.Delete)
		r.Post("/api/spaces/{slug}/refresh", spaceHandler.Refresh)
		r.Put("/api/spaces/{slug}/feature-flags", spaceHandler.UpdateFeatureFlags)

		// Space members
		r.Get("/api/spaces/{slug}/members", spaceHandler.ListMembers)
		r.Post("/api/spaces/{slug}/members", spaceHandler.AddMember)
		r.Put("/api/spaces/{slug}/members/{id}", spaceHandler.UpdateMember)
		r.Delete("/api/spaces/{slug}/members/{id}", spaceHandler.RemoveMember)

		// Pages
		r.Get("/api/spaces/{slug}/pages", pageHandler.GetTree)
		r.Get("/api/spaces/{slug}/pages/starred", pageHandler.ListStarred)
		r.Get("/api/spaces/{slug}/pages/recent", pageHandler.ListRecent)
		r.Get("/api/spaces/{slug}/pages/{id}", pageHandler.GetByID)
		r.Post("/api/spaces/{slug}/pages", pageHandler.Create)
		r.Put("/api/spaces/{slug}/pages/{id}", pageHandler.Update)
		r.Put("/api/spaces/{slug}/pages/{id}/meta", pageHandler.UpdateMeta)
		r.Post("/api/spaces/{slug}/pages/{id}/duplicate", pageHandler.Duplicate)
		r.Post("/api/spaces/{slug}/pages/{id}/restore", pageHandler.RestoreByPageID)
		r.Put("/api/spaces/{slug}/pages/{id}/move", pageHandler.Move)
		r.Delete("/api/spaces/{slug}/pages/{id}", pageHandler.Delete)

		// Synced blocks
		r.Get("/api/spaces/{slug}/synced-block", syncedBlockHandler.Get)
		r.Put("/api/spaces/{slug}/synced-block/{sourceBlockId}", syncedBlockHandler.Update)
		r.Post("/api/spaces/{slug}/synced-block/wrap-source", syncedBlockHandler.WrapSource)
		r.Delete("/api/spaces/{slug}/synced-block/{sourceBlockId}", syncedBlockHandler.Delete)

		// Trash
		r.Get("/api/spaces/{slug}/trash", pageHandler.ListTrash)
		r.Post("/api/spaces/{slug}/trash/restore", pageHandler.RestoreFromTrash)
		r.Post("/api/spaces/{slug}/trash/delete", pageHandler.PermanentDelete)

		// Git (per-space; UI hides these when space isn't a git repo).
		// RequireGitFeature returns 403 when feature_flags.git is off.
		r.Group(func(r chi.Router) {
			r.Use(featureFlagMiddleware.RequireGitFeature)
			r.Get("/api/spaces/{slug}/git/state", gitHandler.State)
			r.Post("/api/spaces/{slug}/git/commit", gitHandler.Commit)
			r.Post("/api/spaces/{slug}/git/restore", gitHandler.Restore)
			r.Post("/api/spaces/{slug}/git/push", gitHandler.Push)
			r.Post("/api/spaces/{slug}/git/pull", gitHandler.Pull)
			r.Get("/api/spaces/{slug}/git/config", gitHandler.GetConfig)
			r.Put("/api/spaces/{slug}/git/config", gitHandler.SetConfig)
			r.Get("/api/spaces/{slug}/git/credentials", gitHandler.GetCredential)
			r.Put("/api/spaces/{slug}/git/credentials", gitHandler.SetCredential)
			r.Delete("/api/spaces/{slug}/git/credentials", gitHandler.DeleteCredential)
		})

		// Search (per-space, streamed as NDJSON)
		r.Get("/api/spaces/{slug}/search/stream", searchHandler.Stream)

		// Files (per-space shared file pool under <space>/_files/)
		r.Get("/api/spaces/{slug}/files", filesHandler.List)
		r.Get("/api/spaces/{slug}/files/content", filesHandler.GetContent)
		r.Put("/api/spaces/{slug}/files/content", filesHandler.PutContent)
		r.Get("/api/spaces/{slug}/files/download", filesHandler.Download)
		r.Get("/api/spaces/{slug}/files/check", filesHandler.CheckName)
		r.Post("/api/spaces/{slug}/files/upload", filesHandler.Upload)
		r.Put("/api/spaces/{slug}/files/rename", filesHandler.Rename)
		r.Delete("/api/spaces/{slug}/files", filesHandler.Delete)

		// Databases (per-space file-backed data sources under <space>/_database/)
		r.Get("/api/spaces/{slug}/databases", databaseHandler.List)
		r.Post("/api/spaces/{slug}/databases", databaseHandler.Create)
		r.Get("/api/spaces/{slug}/databases/{dbId}", databaseHandler.Get)
		r.Patch("/api/spaces/{slug}/databases/{dbId}", databaseHandler.Update)
		r.Delete("/api/spaces/{slug}/databases/{dbId}", databaseHandler.Delete)
		r.Post("/api/spaces/{slug}/databases/{dbId}/columns", databaseHandler.AddColumn)
		r.Patch("/api/spaces/{slug}/databases/{dbId}/columns/{colId}", databaseHandler.UpdateColumn)
		r.Delete("/api/spaces/{slug}/databases/{dbId}/columns/{colId}", databaseHandler.DeleteColumn)
		r.Post("/api/spaces/{slug}/databases/{dbId}/columns/reorder", databaseHandler.ReorderColumns)
		r.Get("/api/spaces/{slug}/databases/{dbId}/rows", databaseHandler.ListRows)
		r.Post("/api/spaces/{slug}/databases/{dbId}/rows", databaseHandler.CreateRow)
		r.Post("/api/spaces/{slug}/databases/{dbId}/rows/reorder", databaseHandler.ReorderRows)
		r.Get("/api/spaces/{slug}/databases/{dbId}/rows/{rowId}", databaseHandler.GetRow)
		r.Patch("/api/spaces/{slug}/databases/{dbId}/rows/{rowId}", databaseHandler.UpdateRow)
		r.Delete("/api/spaces/{slug}/databases/{dbId}/rows/{rowId}", databaseHandler.DeleteRow)
		r.Delete("/api/spaces/{slug}/databases/{dbId}/rows/{rowId}/permanent", databaseHandler.PermanentDeleteRow)
		r.Get("/api/spaces/{slug}/databases/{dbId}/rows/{rowId}/page", databaseHandler.GetRowPage)
		r.Put("/api/spaces/{slug}/databases/{dbId}/rows/{rowId}/page", databaseHandler.PutRowPage)

		// Bookmark
		r.Get("/api/bookmark/meta", bookmarkHandler.GetMeta)

		// Unsplash 代理（按用户偏好里的 key 转发，前端不接触 key）
		r.Get("/api/unsplash/status", unsplashHandler.Status)
		r.Get("/api/unsplash/search", unsplashHandler.Search)

		// Users (admin only)
		r.Group(func(r chi.Router) {
			r.Use(authMiddleware.RequireAdmin)
			r.Get("/api/users", userHandler.List)
			r.Put("/api/site-settings/name", siteSettingHandler.UpdateSiteName)
			r.Post("/api/site-settings/favicon", siteSettingHandler.UploadFavicon)
			r.Post("/api/site-settings/favicon/reset", siteSettingHandler.ResetFavicon)
			r.Post("/api/site-settings/logo", siteSettingHandler.UploadLogo)
			r.Post("/api/site-settings/logo/reset", siteSettingHandler.ResetLogo)
			r.Post("/api/users", userHandler.Create)
			r.Get("/api/users/{id}", userHandler.GetByID)
			r.Put("/api/users/{id}", userHandler.Update)
			r.Delete("/api/users/{id}", userHandler.Delete)
			r.Put("/api/users/{id}/password", userHandler.ResetPassword)

			// Claude admin config
			r.Get("/api/admin/claude/config", claudeHandler.GetConfig)
			r.Put("/api/admin/claude/config", claudeHandler.UpdateConfig)
		})

		// Upload
		r.Post("/api/upload", uploadHandler.Upload)

		// Icon library
		r.Get("/api/icons", uploadHandler.ListIcons)
		r.Get("/api/icons/check", uploadHandler.CheckIconName)
		r.Post("/api/icons/use", uploadHandler.UseIcon)
		r.Post("/api/icons/upload", uploadHandler.UploadIcon)
		r.Post("/api/icons/delete", uploadHandler.DeleteIcon)
		r.Put("/api/icons/rename", uploadHandler.RenameIcon)

		// Cover library
		r.Get("/api/covers", uploadHandler.ListCovers)
		r.Get("/api/covers/check", uploadHandler.CheckCoverName)
		r.Post("/api/covers/use", uploadHandler.UseCover)
		r.Post("/api/covers/upload", uploadHandler.UploadCover)
		r.Post("/api/covers/delete", uploadHandler.DeleteCover)
		r.Put("/api/covers/rename", uploadHandler.RenameCover)
	})

	// Public upload files
	r.Get("/api/upload/{filename}", uploadHandler.ServeUpload)

	// Public icon library files
	r.Get("/api/icons/*", uploadHandler.ServeIcon)

	// Public cover library files
	r.Get("/api/covers/*", uploadHandler.ServeCover)

	// Public site assets (favicon, logo)
	// IMPORTANT: literal PWA-icon paths must be registered before `{filename}`
	// so chi matches them precisely rather than falling through to the wildcard.
	r.Get("/api/site-assets/pwa-icon-192.png", siteSettingHandler.ServePWAIconSizedStatic("192"))
	r.Get("/api/site-assets/pwa-icon-512.png", siteSettingHandler.ServePWAIconSizedStatic("512"))
	r.Get("/api/site-assets/pwa-icon-512-maskable.png", siteSettingHandler.ServePWAIconSizedStatic("512-maskable"))
	r.Get("/api/site-assets/{filename}", siteSettingHandler.ServeAsset)

	// Public PWA manifest (dynamic — reflects current site name + favicon)
	r.Get("/api/manifest.webmanifest", siteSettingHandler.ServeManifest)

	// Public page assets (cover images, etc.) — no auth needed for CSS background-image
	r.Get("/api/spaces/{slug}/pages/{id}/assets/*", pageHandler.ServeAsset)

	// Serve frontend static files + SPA fallback.
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		// Don't serve SPA for API routes — return 404 instead
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		cleanPath := strings.TrimPrefix(r.URL.Path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		filePath := filepath.Join(frontendDist, cleanPath)
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}

		indexPath := filepath.Join(frontendDist, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			http.ServeFile(w, r, indexPath)
			return
		}

		http.NotFound(w, r)
	})
	log.Printf("Serving frontend from %s", frontendDist)
	log.Printf("Docs dir: %s", docsDir)
	log.Printf("Data dir: %s", dataDir)
	log.Printf("Default admin: username=admin, password=admin123")

	application.handler = r
	success = true
	return application, nil
}

func (a *App) Handler() http.Handler {
	return a.handler
}

func (a *App) Config() Config {
	return a.config
}

func (a *App) ListenAndServe() error {
	address := net.JoinHostPort(a.config.BindAddr, a.config.Port)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return err
	}
	log.Printf("Server starting on %s", listener.Addr())
	return a.Serve(listener)
}

func (a *App) Serve(listener net.Listener) error {
	if a.handler == nil {
		return errors.New("application handler is not initialized")
	}
	if err := http.Serve(listener, a.handler); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func (a *App) Close() error {
	if a.gitSyncWorker != nil {
		a.gitSyncWorker.Stop()
		a.gitSyncWorker = nil
	}
	if a.db != nil {
		err := a.db.Close()
		a.db = nil
		return err
	}
	return nil
}

func pageDebugRequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isPageDebugPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		log.Printf("[page-debug] http.start method=%s path=%s rawQuery=%s remote=%s contentLength=%d", r.Method, r.URL.Path, r.URL.RawQuery, r.RemoteAddr, r.ContentLength)
		next.ServeHTTP(w, r)
		log.Printf("[page-debug] http.done method=%s path=%s elapsed=%s", r.Method, r.URL.Path, time.Since(start))
	})
}

func isPageDebugPath(path string) bool {
	return strings.HasPrefix(path, "/api/spaces/") &&
		strings.Contains(path, "/pages/") &&
		!strings.Contains(path, "/pages/starred") &&
		!strings.Contains(path, "/pages/recent")
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// FileServer conveniently sets up a http.FileServer handler to serve
// static files from a http.FileSystem.
func FileServer(r chi.Router, path string, root http.FileSystem) {
	if strings.ContainsAny(path, "{}*") {
		panic("FileServer does not permit any URL parameters.")
	}

	if path != "/" && path[len(path)-1] != '/' {
		r.Get(path, http.RedirectHandler(path+"/", http.StatusMovedPermanently).ServeHTTP)
		path += "/"
	}
	path += "*"

	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.RouteContext(r.Context())
		pathPrefix := strings.TrimSuffix(rctx.RoutePattern(), "/*")
		fs := http.StripPrefix(pathPrefix, http.FileServer(root))
		fs.ServeHTTP(w, r)
	})
}
