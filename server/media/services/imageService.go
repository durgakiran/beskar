package media

import (
	"errors"
	"fmt"
	"io"
	"math/rand"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"github.com/durgakiran/beskar/core"
)

type Image struct {
	Name  string
	Data  []byte
	WData multipart.File
}

func removeSpaces(name string) string {
	return strings.ReplaceAll(name, " ", "-")
}

func generateRandomIdentifier() string {
	const letterBytes = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	b := make([]byte, 8)
	for i := range b {
		b[i] = letterBytes[rand.Intn(len(letterBytes))]
	}
	return string(b)
}

func (i *Image) createFileName() error {
	ext := filepath.Ext(i.Name)
	if len(ext) < 0 {
		return errors.New("Unable to identify file extension")
	}
	if ext != ".png" && ext != ".jpg" && ext != ".jpeg" {
		return errors.New(fmt.Sprintf("Not a compatible file extension: %v", ext))
	}
	randomIdentifier := generateRandomIdentifier()
	finalName := removeSpaces(i.Name) + "-" + randomIdentifier + ext
	i.Name = finalName
	return nil
}

func (i *Image) createPath() error {
	err := os.MkdirAll(core.ImageStorageDir(), 0o755)
	if err != nil {
		core.Logger.Error("Failed to create images directory: " + err.Error())
		return errors.New("Failed to create images directory")
	}
	return nil
}

func (i *Image) SaveImage() error {
	err := i.createFileName()
	if err != nil {
		return err
	}
	err = i.createPath()
	if err != nil {
		return err
	}
	file, err := os.Create(filepath.Join(core.ImageStorageDir(), i.Name))
	if err != nil {
		core.Logger.Error("Failed to create file")
		return errors.New("Failed to create file")
	}
	defer file.Close()
	_, err = io.Copy(file, i.WData)
	if err != nil {
		return errors.New("Failed to copy data to file")
	}
	return nil
}

func GetImage(id string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(core.ImageStorageDir(), id))
	if err == nil {
		return data, nil
	}
	if !errors.Is(err, os.ErrNotExist) || core.UploadStorageDir() == "public" {
		return nil, err
	}

	data, err = os.ReadFile(filepath.Join("public", "images", id))
	if err != nil {
		return nil, err
	}
	return data, nil
}
