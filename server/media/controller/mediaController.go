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
	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Charset", "utf-8")
	w.Write([]byte("OK"))
}

func saveImage(w http.ResponseWriter, r *http.Request) {
	file, header, err := r.FormFile("file")
	defer file.Close()
	if err != nil {
		slog.Error("Error retrieving file: %s", err)
		render.Status(r, http.StatusInternalServerError)
		render.Render(w, r, core.NewFailedResponse(500, err.Error(), ""))
		return
	}
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
	r.Get("/id", getImage)
	r.Post("/upload", saveImage)
	return r
}
