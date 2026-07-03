package project

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCreateProjectPageHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/project/space/123/create", strings.NewReader(`{"title":"Roadmap"}`))
	rr := httptest.NewRecorder()

	createProjectPageHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestGetProjectPageViewHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456", nil)
	rr := httptest.NewRecorder()

	getProjectPageViewHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestListProjectTicketsHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456/tickets", nil)
	rr := httptest.NewRecorder()

	listProjectTicketsHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestListProjectCycleTracksHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456/cycle-tracks", nil)
	rr := httptest.NewRecorder()

	listProjectCycleTracksHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestListProjectCyclesHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456/cycles", nil)
	rr := httptest.NewRecorder()

	listProjectCyclesHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestCreateProjectCycleHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/project/space/123/page/456/cycles", strings.NewReader(`{"name":"Sprint 14"}`))
	rr := httptest.NewRecorder()

	createProjectCycleHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestUpdateProjectCycleHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodPut, "/api/v1/project/space/123/page/456/cycles/abc", strings.NewReader(`{"state":"completed"}`))
	rr := httptest.NewRecorder()

	updateProjectCycleHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestListProjectActivityHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456/activity", nil)
	rr := httptest.NewRecorder()

	listProjectActivityHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestListProjectEventsHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456/events", nil)
	rr := httptest.NewRecorder()

	listProjectEventsHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestCreateProjectTicketHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/project/space/123/page/456/tickets", strings.NewReader(`{"title":"Ship v1"}`))
	rr := httptest.NewRecorder()

	createProjectTicketHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestGetProjectTicketHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456/tickets/abc", nil)
	rr := httptest.NewRecorder()

	getProjectTicketHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestUpdateProjectTicketHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodPut, "/api/v1/project/space/123/page/456/tickets/abc", strings.NewReader(`{"status":"done"}`))
	rr := httptest.NewRecorder()

	updateProjectTicketHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestBulkUpdateProjectTicketsHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/project/space/123/page/456/tickets/bulk-update", strings.NewReader(`{"ticketIds":["abc"],"status":"done"}`))
	rr := httptest.NewRecorder()

	bulkUpdateProjectTicketsHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestCreateProjectTicketCommentHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/project/space/123/page/456/tickets/abc/comments", strings.NewReader(`{"body":"Need design review"}`))
	rr := httptest.NewRecorder()

	createProjectTicketCommentHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestAttachProjectTicketAttachmentHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/project/space/123/page/456/tickets/abc/attachments", strings.NewReader(`{"attachmentId":"def"}`))
	rr := httptest.NewRecorder()

	attachProjectTicketAttachmentHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestDeleteProjectTicketAttachmentHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/project/space/123/page/456/tickets/abc/attachments/def", nil)
	rr := httptest.NewRecorder()

	deleteProjectTicketAttachmentHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestExportProjectTicketsCSVHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456/tickets/export.csv", nil)
	rr := httptest.NewRecorder()

	exportProjectTicketsCSVHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

func TestExportProjectTicketsJSONHandlerRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/project/space/123/page/456/tickets/export.json", nil)
	rr := httptest.NewRecorder()

	exportProjectTicketsJSONHandler(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}
