package apidocs

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestDocumentationRoutes(t *testing.T) {
	r := chi.NewRouter()
	Register(r)
	for _, path := range []string{"/api/docs", "/api/docs/", "/api/openapi.json"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s: status %d", path, w.Code)
		}
		if strings.HasSuffix(path, ".json") {
			if !json.Valid(w.Body.Bytes()) {
				t.Fatal("invalid OpenAPI JSON")
			}
			if !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
				t.Fatal("wrong spec content type")
			}
		} else if !strings.Contains(w.Body.String(), "Scalar.createApiReference") {
			t.Fatal("Scalar console missing")
		}
	}
}

func TestSpecificationReferencesAndOperations(t *testing.T) {
	var doc map[string]any
	if err := json.Unmarshal(specification, &doc); err != nil {
		t.Fatal(err)
	}
	// Broken references otherwise only surface when a user opens the console.
	var visit func(any)
	visit = func(value any) {
		switch v := value.(type) {
		case map[string]any:
			if ref, ok := v["$ref"].(string); ok {
				var target any = doc
				for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
					obj, ok := target.(map[string]any)
					if !ok {
						t.Fatalf("unresolvable reference %s", ref)
					}
					target, ok = obj[part]
					if !ok {
						t.Fatalf("missing reference %s", ref)
					}
				}
			}
			for _, child := range v {
				visit(child)
			}
		case []any:
			for _, child := range v {
				visit(child)
			}
		}
	}
	visit(doc)
	ids := map[string]bool{}
	for path, item := range doc["paths"].(map[string]any) {
		for _, value := range item.(map[string]any) {
			op := value.(map[string]any)
			id, _ := op["operationId"].(string)
			if id == "" || ids[id] {
				t.Fatalf("missing or duplicate operation ID at %s", path)
			}
			ids[id] = true
			if strings.HasPrefix(path, "/auth/") {
				security, ok := op["security"].([]any)
				if !ok || len(security) != 0 {
					t.Fatalf("login flow must not require API credentials: %s", path)
				}
			}
		}
	}
}

func TestMentionOperationsDocumented(t *testing.T) {
	var doc struct {
		Paths map[string]map[string]struct {
			OperationID string                     `json:"operationId"`
			Responses   map[string]json.RawMessage `json:"responses"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(specification, &doc); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/space/{spaceId}/mentions/users", "/api/v1/space/{spaceId}/mentions/users/{userId}"} {
		operation, ok := doc.Paths[path]["get"]
		if !ok || operation.OperationID == "" {
			t.Fatalf("mention endpoint undocumented: %s", path)
		}
		for _, code := range []string{"200", "400", "401", "403", "404", "503"} {
			if _, ok := operation.Responses[code]; !ok {
				t.Fatalf("%s missing status %s", path, code)
			}
		}
	}
}

func TestPageHierarchyOperationsDocumented(t *testing.T) {
	var doc struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
			RequestBody struct {
				Required bool `json:"required"`
			} `json:"requestBody"`
			Responses map[string]json.RawMessage `json:"responses"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(specification, &doc); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/space/{spaceId}/page/{pageId}/parent", "/api/v1/space/{spaceId}/page/{pageId}/order"} {
		operation, ok := doc.Paths[path]["put"]
		if !ok || operation.OperationID == "" || !operation.RequestBody.Required {
			t.Fatalf("page hierarchy write undocumented: %s", path)
		}
		for _, code := range []string{"200", "400", "401", "403", "404", "409", "500"} {
			if _, ok := operation.Responses[code]; !ok {
				t.Fatalf("%s missing status %s", path, code)
			}
		}
	}
}

func TestDocumentSearchOperationDocumented(t *testing.T) {
	var doc struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
			Parameters  []struct {
				Name     string `json:"name"`
				Required bool   `json:"required"`
			} `json:"parameters"`
			Responses map[string]json.RawMessage   `json:"responses"`
			Security  []map[string]json.RawMessage `json:"security"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(specification, &doc); err != nil {
		t.Fatal(err)
	}
	op, ok := doc.Paths["/api/v1/search/documents"]["get"]
	if !ok || op.OperationID != "searchPublishedDocuments" || len(op.Security) == 0 {
		t.Fatal("authenticated search operation missing from OpenAPI")
	}
	foundQuery := false
	for _, p := range op.Parameters {
		if p.Name == "q" && p.Required {
			foundQuery = true
		}
	}
	if !foundQuery {
		t.Fatal("required search query is undocumented")
	}
	for _, code := range []string{"200", "400", "401", "503"} {
		if _, ok := op.Responses[code]; !ok {
			t.Fatalf("search missing response %s", code)
		}
	}
}
