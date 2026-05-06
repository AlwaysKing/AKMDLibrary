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

	"github.com/alwaysking/mdlibrary/internal/handler"
	"github.com/alwaysking/mdlibrary/internal/middleware"
	"github.com/alwaysking/mdlibrary/internal/repository"
	"github.com/alwaysking/mdlibrary/internal/service"
)

func main() {
	port := getEnv("PORT", "8080")
	docsDir := getEnv("DOCS_DIR", filepath.Join("..", "docs"))
	dataDir := getEnv("DATA_DIR", filepath.Join("..", "data"))
	jwtSecret := getEnv("JWT_SECRET", "dev-secret-change-me")
	frontendDist := getEnv("FRONTEND_DIST", filepath.Join("..", "frontend", "dist"))

	// Ensure directories exist
	os.MkdirAll(docsDir, 0755)
	os.MkdirAll(dataDir, 0755)
	uploadDir := filepath.Join(dataDir, "uploads")
	os.MkdirAll(uploadDir, 0755)

	// Initialize database
	db, err := repository.NewDB(dataDir)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	// Initialize repositories
	userRepo := repository.NewUserRepository(db)
	spaceRepo := repository.NewSpaceRepository(db)
	pageRepo := repository.NewPageRepository(db)
	memberRepo := repository.NewMemberRepository(db)

	// Initialize services
	authService := service.NewAuthService(userRepo, jwtSecret)
	userService := service.NewUserService(userRepo, authService)
	spaceService := service.NewSpaceService(spaceRepo, memberRepo, pageRepo, docsDir)
	pageService := service.NewPageService(pageRepo, docsDir)

	// Sync spaces from filesystem on startup
	if err := spaceService.SyncFromFS(); err != nil {
		log.Printf("Warning: failed to sync spaces from filesystem: %v", err)
	}

	// Initialize handlers
	authHandler := handler.NewAuthHandler(authService)
	userHandler := handler.NewUserHandler(userService)
	spaceHandler := handler.NewSpaceHandler(spaceService)
	pageHandler := handler.NewPageHandler(pageService, spaceService)
	uploadHandler := handler.NewUploadHandler(pageService, uploadDir)

	// Initialize middleware
	authMiddleware := middleware.NewAuthMiddleware(authService)

	// Router
	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
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

	// Protected routes
	r.Group(func(r chi.Router) {
		r.Use(authMiddleware.RequireAuth)

		r.Get("/api/auth/me", authHandler.Me)

		// Spaces
		r.Get("/api/spaces", spaceHandler.List)
		r.Get("/api/spaces/{slug}", spaceHandler.Get)
		r.Post("/api/spaces", spaceHandler.Create)
		r.Put("/api/spaces/{slug}", spaceHandler.Update)
		r.Delete("/api/spaces/{slug}", spaceHandler.Delete)

		// Space members
		r.Get("/api/spaces/{slug}/members", spaceHandler.ListMembers)
		r.Post("/api/spaces/{slug}/members", spaceHandler.AddMember)
		r.Put("/api/spaces/{slug}/members/{id}", spaceHandler.UpdateMember)
		r.Delete("/api/spaces/{slug}/members/{id}", spaceHandler.RemoveMember)

		// Pages
		r.Get("/api/spaces/{slug}/pages", pageHandler.GetTree)
		r.Get("/api/spaces/{slug}/pages/{id}", pageHandler.GetByID)
		r.Post("/api/spaces/{slug}/pages", pageHandler.Create)
		r.Put("/api/spaces/{slug}/pages/{id}", pageHandler.Update)
		r.Put("/api/spaces/{slug}/pages/{id}/meta", pageHandler.UpdateMeta)
		r.Delete("/api/spaces/{slug}/pages/{id}", pageHandler.Delete)
		r.Get("/api/spaces/{slug}/pages/{id}/assets/*", pageHandler.ServeAsset)

		// Users (admin only)
		r.Group(func(r chi.Router) {
			r.Use(authMiddleware.RequireAdmin)
			r.Get("/api/users", userHandler.List)
			r.Post("/api/users", userHandler.Create)
			r.Get("/api/users/{id}", userHandler.GetByID)
			r.Put("/api/users/{id}", userHandler.Update)
			r.Delete("/api/users/{id}", userHandler.Delete)
		})

		// Upload
		r.Post("/api/upload", uploadHandler.Upload)
	})

	// Public upload files
	r.Get("/api/upload/{filename}", uploadHandler.ServeUpload)

	// Serve frontend static files + SPA fallback
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
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
