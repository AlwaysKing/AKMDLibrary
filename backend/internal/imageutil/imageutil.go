// Package imageutil decodes arbitrary uploaded images and produces the PNG
// variants required by the PWA manifest (192, 512, 512-maskable).
package imageutil

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"

	"golang.org/x/image/draw"
)

// Decode reads an image stream and returns the decoded raster plus its format
// name (png / jpeg / gif / webp / bmp). Returns an error for SVG or unknown
// formats — callers should fall back to saving those as-is.
func Decode(r io.Reader) (image.Image, string, error) {
	img, format, err := image.Decode(r)
	if err != nil {
		return nil, "", fmt.Errorf("imageutil: decode: %w", err)
	}
	return img, format, nil
}

// ResizePNG scales img to size×size preserving aspect ratio (letterboxed
// with transparent background) and writes it to w as PNG.
func ResizePNG(w io.Writer, img image.Image, size int) error {
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	// NewRGBA is zero-filled = fully transparent; letterbox preserves aspect.
	srcBounds := img.Bounds()
	srcW, srcH := srcBounds.Dx(), srcBounds.Dy()
	scale := min(float64(size)/float64(srcW), float64(size)/float64(srcH))
	outW := int(float64(srcW) * scale)
	outH := int(float64(srcH) * scale)
	r := image.Rect((size-outW)/2, (size-outH)/2, (size+outW)/2, (size+outH)/2)
	draw.CatmullRom.Scale(dst, r, img, srcBounds, draw.Over, nil)
	if err := png.Encode(w, dst); err != nil {
		return fmt.Errorf("imageutil: encode resized: %w", err)
	}
	return nil
}

// ComposeMaskable renders img onto a size×size opaque white canvas with the
// source centered at 80% scale — the ~10% safe zone required by Android's
// maskable icon spec.
func ComposeMaskable(w io.Writer, img image.Image, size int) error {
	canvas := image.NewRGBA(image.Rect(0, 0, size, size))
	white := image.NewUniform(color.RGBA{R: 255, G: 255, B: 255, A: 255})
	draw.Draw(canvas, canvas.Bounds(), white, image.Point{}, draw.Src)

	innerSize := int(float64(size) * 0.8)
	inner := image.NewRGBA(image.Rect(0, 0, innerSize, innerSize))
	srcBounds := img.Bounds()
	srcW, srcH := srcBounds.Dx(), srcBounds.Dy()
	scale := min(float64(innerSize)/float64(srcW), float64(innerSize)/float64(srcH))
	outW := int(float64(srcW) * scale)
	outH := int(float64(srcH) * scale)
	r := image.Rect((innerSize-outW)/2, (innerSize-outH)/2, (innerSize+outW)/2, (innerSize+outH)/2)
	draw.CatmullRom.Scale(inner, r, img, srcBounds, draw.Over, nil)

	offset := (size - innerSize) / 2
	draw.Draw(canvas, image.Rect(offset, offset, offset+innerSize, offset+innerSize), inner, image.Point{}, draw.Over)

	if err := png.Encode(w, canvas); err != nil {
		return fmt.Errorf("imageutil: encode maskable: %w", err)
	}
	return nil
}

// ProcessToPWAVariants decodes r and writes three PNGs into outDir:
//   - pwa-icon-192.png          (purpose: any)
//   - pwa-icon-512.png          (purpose: any)
//   - pwa-icon-512-maskable.png (purpose: maskable)
//
// Returns the relative filenames written.
func ProcessToPWAVariants(outDir string, r io.Reader) ([]string, error) {
	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		return nil, fmt.Errorf("imageutil: read source: %w", err)
	}
	img, _, err := Decode(bytes.NewReader(buf.Bytes()))
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return nil, fmt.Errorf("imageutil: mkdir: %w", err)
	}
	names := []string{"pwa-icon-192.png", "pwa-icon-512.png", "pwa-icon-512-maskable.png"}
	for _, name := range names {
		f, err := os.Create(filepath.Join(outDir, name))
		if err != nil {
			return nil, fmt.Errorf("imageutil: create %s: %w", name, err)
		}
		switch name {
		case "pwa-icon-192.png":
			err = ResizePNG(f, img, 192)
		case "pwa-icon-512.png":
			err = ResizePNG(f, img, 512)
		case "pwa-icon-512-maskable.png":
			err = ComposeMaskable(f, img, 512)
		}
		f.Close()
		if err != nil {
			return nil, fmt.Errorf("imageutil: write %s: %w", name, err)
		}
	}
	return names, nil
}
