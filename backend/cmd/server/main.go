package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"

	"github.com/alwaysking/akmdlibrary/internal/app"
)

func main() {
	loadEnv()

	application, err := app.NewFromEnv()
	if err != nil {
		log.Fatalf("Failed to initialize application: %v", err)
	}
	defer application.Close()

	if err := application.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func loadEnv() {
	for _, file := range []string{".env", "../.env", "../../.env"} {
		if _, err := os.Stat(file); err == nil {
			_ = godotenv.Load(file)
			return
		}
	}
}
