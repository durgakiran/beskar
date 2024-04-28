package media

import (
	"log/slog"
	"net/http"

	"github.com/durgakiran/beskar/core"
	media "github.com/durgakiran/beskar/media/services"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

type fileNameType struct {
	Name string
}

func getImage(w http.ResponseWriter, r *http.Request) {
	imageId := chi.URLParam(r, "imageid")
	data, err := media.GetImage(imageId)
	if err != nil {
		slog.Error("Error retrieving file: %s", err)
		render.Status(r, http.StatusNoContent)
		render.Render(w, r, core.NewFailedResponse(http.StatusNoContent, err.Error(), ""))
		return
	}

	w.Header().Add("Content-Disposition", imageId)
	w.Header().Add("Content-Type", http.DetectContentType(data))
	w.Write(data)
}

func saveImage(w http.ResponseWriter, r *http.Request) {
	file, header, err := r.FormFile("file")
	if err != nil {
		slog.Error("Error retrieving file: %s", err)
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, err.Error(), ""))
		return
	}
	defer file.Close()
	image := media.Image{Name: header.Filename, WData: file}
	err = image.SaveImage()
	if err != nil {
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, err.Error(), ""))
		return
	}
	data := fileNameType{
		Name: image.Name,
	}
	render.Status(r, http.StatusCreated)
	render.Render(w, r, core.NewSucessResponse(core.SUCCESS, data))
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.AuthMiddleWare)
	r.Get("/image/{imageid}", getImage)
	r.Post("/upload", saveImage)
	return r
}
