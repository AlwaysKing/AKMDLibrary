//go:build desktop

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"

	"github.com/alwaysking/akmdlibrary/internal/app"
)

type desktopPaths struct {
	DataDir      string
	DocsDir      string
	FrontendDist string
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)

	paths, err := resolveDesktopPaths()
	if err != nil {
		log.Fatalf("resolve desktop paths: %v", err)
	}
	setupDesktopLog(paths.DataDir)

	jwtSecret, err := loadOrCreateJWTSecret(paths.DataDir)
	if err != nil {
		log.Fatalf("initialize JWT secret: %v", err)
	}

	application, err := app.New(app.Config{
		BindAddr:     "127.0.0.1",
		Port:         "0",
		DocsDir:      paths.DocsDir,
		DataDir:      paths.DataDir,
		JWTSecret:    jwtSecret,
		FrontendDist: paths.FrontendDist,
		DesktopMode:  true,
	})
	if err != nil {
		log.Fatalf("initialize application: %v", err)
	}
	defer application.Close()

	apiPort := strings.TrimSpace(os.Getenv("AKMDL_DESKTOP_API_PORT"))
	if apiPort == "" {
		apiPort = "0"
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", apiPort))
	if err != nil {
		log.Fatalf("listen loopback: %v", err)
	}
	defer listener.Close()

	apiURL := "http://" + listener.Addr().String()
	server := &http.Server{Handler: application.Handler()}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("desktop API server stopped: %v", err)
		}
	}()

	debugFrontendURL := strings.TrimSpace(os.Getenv("AKMDL_DESKTOP_FRONTEND_URL"))
	if debugFrontendURL == "" {
		if _, err := os.Stat(filepath.Join(paths.FrontendDist, "index.html")); err != nil {
			log.Fatalf("frontend resources not found in %s: %v", paths.FrontendDist, err)
		}
	}

	baseURL := apiURL
	if debugFrontendURL != "" {
		baseURL = debugFrontendURL
	}
	launchURL, err := desktopLaunchURL(baseURL)
	if err != nil {
		log.Fatalf("invalid desktop frontend URL: %v", err)
	}

	log.Printf("desktop API: %s", apiURL)
	log.Printf("desktop launch URL: %s", launchURL)
	log.Printf("desktop frontend: %s", paths.FrontendDist)
	log.Printf("desktop data: %s", paths.DataDir)
	log.Printf("desktop docs: %s", paths.DocsDir)

	err = wails.Run(&options.App{
		Title:     "AKMDLibrary",
		Width:     1280,
		Height:    900,
		MinWidth:  900,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AKMDLibrary</title>
</head>
<body>
  <script>window.location.replace(%q);</script>
</body>
</html>`, launchURL)
			}),
		},
		Mac: &mac.Options{
			Appearance: mac.NSAppearanceNameAqua,
			TitleBar:   mac.TitleBarHidden(),
		},
		OnDomReady: func(context.Context) {
			installNativeTitleBarDrag()
		},
		OnShutdown: func(ctx context.Context) {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = server.Shutdown(shutdownCtx)
			_ = application.Close()
		},
		Debug: options.Debug{
			OpenInspectorOnStartup: strings.TrimSpace(os.Getenv("AKMDL_DESKTOP_DEBUG")) == "1",
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.alwaysking.akmdlibrary",
		},
	})
	if err != nil {
		log.Fatalf("wails run: %v", err)
	}
}

func resolveDesktopPaths() (desktopPaths, error) {
	appDir, err := os.UserConfigDir()
	if err != nil {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return desktopPaths{}, errors.Join(err, homeErr)
		}
		appDir = filepath.Join(home, ".config")
	}
	appDir = filepath.Join(appDir, "AKMDLibrary")

	dataDir := strings.TrimSpace(os.Getenv("DATA_DIR"))
	if dataDir == "" {
		dataDir = filepath.Join(appDir, "data")
	}
	dataDir, err = filepath.Abs(dataDir)
	if err != nil {
		return desktopPaths{}, err
	}

	docsDir := strings.TrimSpace(os.Getenv("DOCS_DIR"))
	if docsDir == "" {
		docsDir = filepath.Join(appDir, "docs")
	}
	docsDir, err = filepath.Abs(docsDir)
	if err != nil {
		return desktopPaths{}, err
	}

	frontendDist := strings.TrimSpace(os.Getenv("FRONTEND_DIST"))
	if frontendDist == "" {
		frontendDist, err = defaultFrontendDist()
		if err != nil {
			return desktopPaths{}, err
		}
	}
	frontendDist, err = filepath.Abs(frontendDist)
	if err != nil {
		return desktopPaths{}, err
	}

	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return desktopPaths{}, err
	}
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		return desktopPaths{}, err
	}

	return desktopPaths{
		DataDir:      dataDir,
		DocsDir:      docsDir,
		FrontendDist: frontendDist,
	}, nil
}

func defaultFrontendDist() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return "", err
	}
	exeDir := filepath.Dir(executable)
	if goruntime.GOOS == "darwin" {
		return filepath.Join(exeDir, "..", "Resources", "html"), nil
	}
	return filepath.Join(exeDir, "resources", "html"), nil
}

func loadOrCreateJWTSecret(dataDir string) (string, error) {
	if secret := strings.TrimSpace(os.Getenv("JWT_SECRET")); secret != "" {
		return secret, nil
	}

	secretPath := filepath.Join(dataDir, "jwt_secret")
	if data, err := os.ReadFile(secretPath); err == nil {
		if secret := strings.TrimSpace(string(data)); secret != "" {
			return secret, nil
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}

	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", err
	}
	secret := hex.EncodeToString(randomBytes)
	if err := os.WriteFile(secretPath, []byte(secret+"\n"), 0600); err != nil {
		return "", err
	}
	return secret, nil
}

func setupDesktopLog(dataDir string) {
	logPath := filepath.Join(dataDir, "desktop.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	log.SetOutput(io.MultiWriter(os.Stderr, logFile))
}

func desktopLaunchURL(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("unsupported scheme %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return "", errors.New("missing host")
	}
	query := parsed.Query()
	query.Set("desktop", "1")
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
