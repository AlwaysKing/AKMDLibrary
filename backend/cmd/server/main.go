package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"

	"github.com/alwaysking/akmdlibrary/internal/handler"
	"github.com/alwaysking/akmdlibrary/internal/middleware"
	"github.com/alwaysking/akmdlibrary/internal/repository"
	"github.com/alwaysking/akmdlibrary/internal/service"
	"github.com/alwaysking/akmdlibrary/internal/service/claude"
)

func main() {
	// 加载项目根的 .env 文件（调试时使用），没文件不报错
	// godotenv.Load 任一文件失败会提前返回，所以手动按优先级找第一个存在的
	for _, f := range []string{".env", "../.env", "../../.env"} {
		if _, err := os.Stat(f); err == nil {
			_ = godotenv.Load(f)
			break
		}
	}

	port := getEnv("PORT", "8080")
	docsDir := getEnv("DOCS_DIR", "/app/docs")
	dataDir := getEnv("DATA_DIR", "/app/data")
	jwtSecret := getEnv("JWT_SECRET", "dev-secret-change-me")
	frontendDist := getEnv("FRONTEND_DIST", "/app/html")

	// Ensure directories exist
	os.MkdirAll(docsDir, 0755)
	os.MkdirAll(dataDir, 0755)
	uploadDir := filepath.Join(dataDir, "uploads")
	os.MkdirAll(uploadDir, 0755)
	iconDir := filepath.Join(dataDir, "icons")
	os.MkdirAll(iconDir, 0755)
	coverDir := filepath.Join(dataDir, "covers")
	os.MkdirAll(coverDir, 0755)
	siteDir := filepath.Join(dataDir, "site")
	os.MkdirAll(siteDir, 0755)

	// Initialize database
	db, err := repository.NewDB(dataDir)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Initialize repositories
	userRepo := repository.NewUserRepository(db)
	spaceRepo := repository.NewSpaceRepository(db)
	memberRepo := repository.NewMemberRepository(db)
	prefRepo := repository.NewPreferenceRepository(db)
	siteSettingRepo := repository.NewSiteSettingRepository(db)
	bookmarkRepo := repository.NewBookmarkRepository(db.DB)

	// Initialize services
	authService := service.NewAuthService(userRepo, jwtSecret)
	userService := service.NewUserService(userRepo, authService)
	gitService := service.NewGitService(docsDir)
	gitService.SetCredentialStore(service.NewCredentialStore(filepath.Join(dataDir, "git_credentials")))
	gitSyncWorker := service.NewGitSyncWorker(gitService)
	// When config changes, invalidate the worker's cache so new auto-commit
	// settings apply immediately instead of after the TTL.
	gitService.SetOnConfigChange(gitSyncWorker.InvalidateConfig)
	gitSyncWorker.Start()
	defer gitSyncWorker.Stop()
	pageService := service.NewPageService(docsDir)
	pageService.SetGitSyncWorker(gitSyncWorker)
	spaceService := service.NewSpaceService(spaceRepo, memberRepo, pageService, docsDir)
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
	userHandler := handler.NewUserHandler(userService)
	spaceHandler := handler.NewSpaceHandler(spaceService, authService)
	pageHandler := handler.NewPageHandler(pageService, spaceService, authService)
	uploadHandler := handler.NewUploadHandler(pageService, uploadDir, iconDir, coverDir)
	prefHandler := handler.NewPreferenceHandler(prefService)
	siteSettingHandler := handler.NewSiteSettingHandler(siteSettingService, siteDir)
	bookmarkHandler := handler.NewBookmarkHandler(bookmarkService)
	claudeHandler := handler.NewClaudeHandler(claudeConfigStore, claudeManager)
	unsplashHandler := handler.NewUnsplashHandler(prefService)
	gitHandler := handler.NewGitHandler(gitService, spaceService)
	searchHandler := handler.NewSearchHandler(searchService, spaceService)
	filesHandler := handler.NewFilesHandler(docsDir, spaceService)
	syncedBlockHandler := handler.NewSyncedBlockHandler(pageService, spaceService)

	// Initialize middleware
	authMiddleware := middleware.NewAuthMiddleware(authService)
	featureFlagMiddleware := middleware.NewFeatureFlagMiddleware(spaceService)

	// Router
	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(middleware.ErrorLogging)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Public routes
	r.Post("/api/auth/login", authHandler.Login)
	r.Post("/api/auth/logout", authHandler.Logout)
	r.Get("/api/site-settings", siteSettingHandler.Get)
	// Claude WebSocket（独立鉴权——浏览器 WS 不能用 Authorization header）
	r.Get("/api/spaces/{slug}/claude/ws", claudeHandler.ChatWS)
	// Claude 附件上传（multipart，5MB 上限，鉴权同 WS：query param ?token=）
	r.Post("/api/spaces/{slug}/claude/attachments", claudeHandler.UploadAttachment)

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware.RequireAuth)

		r.Get("/api/auth/me", authHandler.Me)
		r.Put("/api/auth/profile", authHandler.UpdateProfile)
		r.Put("/api/auth/password", authHandler.ChangePassword)

		// Preferences
		r.Get("/api/user/preferences", prefHandler.Get)
		r.Put("/api/user/preferences", prefHandler.Update)

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

	// Serve frontend static files + SPA fallback
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		// Don't serve SPA for API routes — return 404 instead
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		// Clean the path
		cleanPath := strings.TrimPrefix(r.URL.Path, "/")
		if cleanPath == "" {
			cleanPath = "index.html"
		}

		// Try to serve the exact file first
		filePath := filepath.Join(frontendDist, cleanPath)
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}

		// SPA fallback: serve index.html for client-side routing
		indexPath := filepath.Join(frontendDist, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			http.ServeFile(w, r, indexPath)
			return
		}

		http.NotFound(w, r)
	})
	log.Printf("Serving frontend from %s", frontendDist)

	log.Printf("Server starting on :%s", port)
	log.Printf("Docs dir: %s", docsDir)
	log.Printf("Data dir: %s", dataDir)
	log.Printf("Default admin: username=admin, password=admin123")
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
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
