package notificationv2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.uber.org/zap"
)

type definitionService interface {
	Create(context.Context, Producer, string, DefinitionInput) (Definition, bool, error)
	Get(context.Context, Producer, uuid.UUID) (Definition, error)
	List(context.Context, Producer, int, string, string) (ListResult, error)
	Patch(context.Context, Producer, uuid.UUID, int64, map[string]json.RawMessage) (Definition, error)
	Transition(context.Context, Producer, uuid.UUID, int64, string) (Definition, error)
}
type ProducerResolver func(*http.Request) (Producer, error)
type Controller struct {
	service definitionService
	resolve ProducerResolver
}

func NewController(service *Service, resolve ProducerResolver) *Controller {
	return &Controller{service: service, resolve: resolve}
}

type producerKey struct{}

func (c *Controller) Router() *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			if c.resolve == nil {
				respondError(w, r, &apiError{http.StatusServiceUnavailable, "producer authentication is not configured"})
				return
			}
			p, err := c.resolve(r)
			if err != nil {
				respondError(w, r, err)
				return
			}
			if p.Source == "" || p.ActorID == uuid.Nil {
				respondError(w, r, &apiError{http.StatusForbidden, "producer access required"})
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), producerKey{}, p)))
		})
	})
	r.Post("/", c.create)
	r.Get("/", c.list)
	r.Get("/{id}", c.get)
	r.Patch("/{id}", c.patch)
	for _, action := range []string{"pause", "resume", "cancel"} {
		r.Post("/{id}/"+action, c.transition(action))
	}
	r.Delete("/{id}", c.transition("delete"))
	return r
}
func producer(r *http.Request) Producer { return r.Context().Value(producerKey{}).(Producer) }
func respondError(w http.ResponseWriter, r *http.Request, err error) {
	var e *apiError
	if !errors.As(err, &e) {
		if core.Logger != nil {
			core.Logger.Error("notification v2 API failed", zap.Error(err))
		}
		e = &apiError{http.StatusInternalServerError, "unable to process notification definition"}
	}
	if e.Status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", `Bearer realm="notifications-v2"`)
	}
	core.SendFailedReponse(w, r, e.Status, e.Message)
}
func respondDefinition(w http.ResponseWriter, r *http.Request, status int, d Definition) {
	w.Header().Set("ETag", strconv.Quote(strconv.FormatInt(d.Revision, 10)))
	core.SendSuccessResponse(w, r, status, d)
}
func parseID(r *http.Request) (uuid.UUID, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, &apiError{400, "invalid notification ID"}
	}
	return id, nil
}
func expectedRevision(r *http.Request) (int64, error) {
	v := r.Header.Get("If-Match")
	if v == "" {
		return 0, &apiError{428, "If-Match with the current revision ETag is required"}
	}
	if len(r.Header.Values("If-Match")) != 1 || len(v) < 3 || v[0] != '"' || v[len(v)-1] != '"' {
		return 0, &apiError{400, "If-Match must be a single quoted revision number"}
	}
	number, err := strconv.ParseInt(v[1:len(v)-1], 10, 64)
	if err != nil || number < 1 {
		return 0, &apiError{400, "invalid revision ETag"}
	}
	return number, nil
}
func decodeObject(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, error) {
	kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || kind != "application/json" {
		return nil, &apiError{415, "Content-Type must be application/json"}
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	var fields map[string]json.RawMessage
	if err = dec.Decode(&fields); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, &apiError{413, "request exceeds 128 KiB"}
		}
		return nil, &apiError{400, "invalid JSON object"}
	}
	if fields == nil {
		return nil, &apiError{400, "a JSON object is required"}
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return nil, &apiError{400, "request must contain one JSON object"}
	}
	return fields, nil
}
func (c *Controller) create(w http.ResponseWriter, r *http.Request) {
	fields, err := decodeObject(w, r)
	if err != nil {
		respondError(w, r, err)
		return
	}
	required := []string{"notification_type_id", "notification_topic_id", "mode_id", "template_id", "template_version", "message_details", "priority", "schedule_kind", "misfire_policy"}
	for _, key := range required {
		v, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
			respondError(w, r, invalid("missing required field: "+key))
			return
		}
	}
	raw, _ := json.Marshal(fields)
	var in DefinitionInput
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&in); err != nil {
		respondError(w, r, &apiError{400, "invalid or unknown definition field"})
		return
	}
	if len(r.Header.Values("Idempotency-Key")) != 1 {
		respondError(w, r, &apiError{400, "one Idempotency-Key header is required"})
		return
	}
	d, created, err := c.service.Create(r.Context(), producer(r), r.Header.Get("Idempotency-Key"), in)
	if err != nil {
		respondError(w, r, err)
		return
	}
	code := http.StatusOK
	if created {
		code = http.StatusCreated
	}
	w.Header().Set("Location", "/api/v2/notifications/"+d.ID.String())
	respondDefinition(w, r, code, d)
}
func (c *Controller) get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		respondError(w, r, err)
		return
	}
	d, err := c.service.Get(r.Context(), producer(r), id)
	if err != nil {
		respondError(w, r, err)
		return
	}
	respondDefinition(w, r, 200, d)
}
func (c *Controller) list(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			respondError(w, r, &apiError{400, "invalid limit"})
			return
		}
		limit = n
	}
	out, err := c.service.List(r.Context(), producer(r), limit, r.URL.Query().Get("cursor"), r.URL.Query().Get("status"))
	if err != nil {
		respondError(w, r, err)
		return
	}
	core.SendSuccessResponse(w, r, 200, out)
}
func (c *Controller) patch(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		respondError(w, r, err)
		return
	}
	revision, err := expectedRevision(r)
	if err != nil {
		respondError(w, r, err)
		return
	}
	fields, err := decodeObject(w, r)
	if err != nil {
		respondError(w, r, err)
		return
	}
	d, err := c.service.Patch(r.Context(), producer(r), id, revision, fields)
	if err != nil {
		respondError(w, r, err)
		return
	}
	respondDefinition(w, r, 200, d)
}
func (c *Controller) transition(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := parseID(r)
		if err != nil {
			respondError(w, r, err)
			return
		}
		revision, err := expectedRevision(r)
		if err != nil {
			respondError(w, r, err)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024))
		if err != nil {
			respondError(w, r, &apiError{400, "invalid lifecycle request body"})
			return
		}
		body := strings.TrimSpace(string(raw))
		if body != "" && body != "{}" {
			respondError(w, r, &apiError{400, "lifecycle actions accept no fields"})
			return
		}
		d, err := c.service.Transition(r.Context(), producer(r), id, revision, action)
		if err != nil {
			respondError(w, r, err)
			return
		}
		if action == "delete" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		respondDefinition(w, r, 200, d)
	}
}
