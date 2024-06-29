package editor

import (
	"fmt"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
)

func saveDoc(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	fmt.Println(ctx.Value("claims"))
	w.WriteHeader(http.StatusAccepted)
}

func Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(core.AuthMiddleWare)
	r.Post("/save", saveDoc)
	return r
}
