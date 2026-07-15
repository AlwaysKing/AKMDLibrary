package imageutil

import (
	"bytes"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestDecode_PNG(t *testing.T) {
	b, err := os.ReadFile("testdata/src.png")
	if err != nil {
		t.Fatalf("read src: %v", err)
	}
	img, format, err := Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if format != "png" {
		t.Fatalf("format = %q, want png", format)
	}
	if img.Bounds().Dx() != 512 || img.Bounds().Dy() != 512 {
		t.Fatalf("bounds = %v, want 512x512", img.Bounds())
	}
}

func TestResizePNG(t *testing.T) {
	src, _ := os.ReadFile("testdata/src.png")
	img, _, _ := Decode(bytes.NewReader(src))

	var buf bytes.Buffer
	if err := ResizePNG(&buf, img, 192); err != nil {
		t.Fatalf("resize: %v", err)
	}
	out, err := png.Decode(&buf)
	if err != nil {
		t.Fatalf("decode resized: %v", err)
	}
	if out.Bounds().Dx() != 192 || out.Bounds().Dy() != 192 {
		t.Fatalf("size = %v, want 192x192", out.Bounds())
	}
}

func TestComposeMaskable_HasPadding(t *testing.T) {
	src, _ := os.ReadFile("testdata/src.png")
	img, _, _ := Decode(bytes.NewReader(src))

	var buf bytes.Buffer
	if err := ComposeMaskable(&buf, img, 512); err != nil {
		t.Fatalf("compose: %v", err)
	}
	out, _ := png.Decode(&buf)
	bounds := out.Bounds()
	if bounds.Dx() != 512 || bounds.Dy() != 512 {
		t.Fatalf("size = %v, want 512x512", bounds)
	}
	// Corner pixel should be opaque white (the safe-zone padding) since the
	// source is centered at 80% scale.
	r, g, b, a := out.At(0, 0).RGBA()
	if r < 0xF000 || g < 0xF000 || b < 0xF000 {
		t.Fatalf("corner RGB = (%d,%d,%d), want near-white padding", r>>8, g>>8, b>>8)
	}
	if a != 0xFFFF {
		t.Fatalf("corner alpha = %d, want fully opaque", a>>8)
	}
}

func TestProcessToPWAVariants(t *testing.T) {
	src, _ := os.ReadFile("testdata/src.png")
	tmp := t.TempDir()
	variants, err := ProcessToPWAVariants(tmp, bytes.NewReader(src))
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	want := []string{"pwa-icon-192.png", "pwa-icon-512.png", "pwa-icon-512-maskable.png"}
	if len(variants) != len(want) {
		t.Fatalf("variants = %v, want %v", variants, want)
	}
	for _, name := range want {
		info, err := os.Stat(filepath.Join(tmp, name))
		if err != nil {
			t.Fatalf("stat %s: %v", name, err)
		}
		if info.Size() == 0 {
			t.Fatalf("%s is empty", name)
		}
	}
}
