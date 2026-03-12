package main

import (
	"fmt"
	"image"
	"image/png"
	"os"

	"golang.org/x/image/draw"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	srcPath := "../frontend/public/app-icon.png"
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("failed to open source icon %s: %w", srcPath, err)
	}
	defer srcFile.Close()

	srcImg, err := png.Decode(srcFile)
	if err != nil {
		return fmt.Errorf("failed to decode source icon: %w", err)
	}

	// Generate standard Windows icon sizes
	sizes := []int{256, 48, 32, 16}
	for _, size := range sizes {
		path := fmt.Sprintf("winres/icon%d.png", size)
		if size == 256 {
			path = "winres/icon.png" // Keep existing default name for 256
		}
		if err := resizeAndSave(srcImg, size, path); err != nil {
			return err
		}
	}

	fmt.Println("Successfully generated icons in winres/")
	return nil
}

func resizeAndSave(src image.Image, size int, dstPath string) error {
	dstImg := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.BiLinear.Scale(dstImg, dstImg.Bounds(), src, src.Bounds(), draw.Over, nil)

	dstFile, err := os.Create(dstPath)
	if err != nil {
		return fmt.Errorf("failed to create destination file %s: %w", dstPath, err)
	}
	defer dstFile.Close()

	if err := png.Encode(dstFile, dstImg); err != nil {
		return fmt.Errorf("failed to encode destination image %s: %w", dstPath, err)
	}

	return nil
}
