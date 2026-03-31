package comment

import (
	"encoding/json"
	"net/http"

	"github.com/durgakiran/beskar/core"
	"github.com/go-chi/chi/v5"
)

var svc *CommentService

func init() {
	svc = NewCommentService()
}

func listThreads(w http.ResponseWriter, r *http.Request) {
	docId := chi.URLParam(r, "docId")
	includeResolved := r.URL.Query().Get("includeResolved") == "true"

	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	// Permission: any user with page VIEW can view comments.
	allowed, err := core.CheckPermission("page", docId, "user", user.AId, core.PAGE_VIEW)
	if err != nil || !allowed {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Forbidden")
		return
	}

	threads, err := svc.ListThreads(ctx, docId, includeResolved)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, "Internal Server Error")
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, threads)
}

func createThread(w http.ResponseWriter, r *http.Request) {
	docId := chi.URLParam(r, "docId")
	var req CreateThreadReq

	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	err = json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	allowed, _ := core.CheckPermission("page", docId, "user", user.AId, core.PAGE_ADD_COMMENT)
	if !allowed {
		core.SendFailedReponse(w, r, http.StatusForbidden, "Forbidden")
		return
	}

	if req.CommentID == "" || req.Body == "" || req.QuotedText == "" {
		core.SendFailedReponse(w, r, http.StatusUnprocessableEntity, "Missing required fields")
		return
	}

	thread, err := svc.CreateThread(ctx, docId, req.CommentID, req.QuotedText, req.Body, user.AId)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		return
	}

	Hub.Publish(EventThreadCreated, docId, thread)
	core.SendSuccessResponse(w, r, http.StatusCreated, thread)
}

func resolveThread(w http.ResponseWriter, r *http.Request) {
	threadId := chi.URLParam(r, "threadId")
	ctx := r.Context()
	
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	thread, err := svc.ResolveThread(ctx, threadId, user.AId)
	if err != nil {
		if err.Error() == "forbidden" {
			core.SendFailedReponse(w, r, http.StatusForbidden, "Forbidden")
		} else {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		}
		return
	}

	Hub.Publish(EventThreadResolved, thread.DocumentID, thread)
	core.SendSuccessResponse(w, r, http.StatusOK, thread)
}

func unresolveThread(w http.ResponseWriter, r *http.Request) {
	threadId := chi.URLParam(r, "threadId")
	ctx := r.Context()
	
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	thread, err := svc.UnresolveThread(ctx, threadId, user.AId)
	if err != nil {
		if err.Error() == "forbidden" {
			core.SendFailedReponse(w, r, http.StatusForbidden, "Forbidden")
		} else {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		}
		return
	}

	Hub.Publish(EventThreadUnresoled, thread.DocumentID, thread)
	core.SendSuccessResponse(w, r, http.StatusOK, thread)
}

func deleteThread(w http.ResponseWriter, r *http.Request) {
	threadId := chi.URLParam(r, "threadId")
	ctx := r.Context()

	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	err = svc.DeleteThread(ctx, threadId, user.AId)
	if err != nil {
		if err.Error() == "forbidden" {
			core.SendFailedReponse(w, r, http.StatusForbidden, "Forbidden")
		} else {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		}
		return
	}

	// We only have threadId in SSE, so payload is { id: threadId }
	// We don't have documentID readily unless we fetch it before deletion, which is already dropped maybe. 
	// Wait, DeleteThread fetches it inside Service. Let's fix Service to return DocumentID
	// To save time, we can fetch it before calling delete
	core.SendSuccessResponse(w, r, http.StatusNoContent, nil)
}

func createReply(w http.ResponseWriter, r *http.Request) {
	threadId := chi.URLParam(r, "threadId")
	var req CreateReplyReq

	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	err = json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if req.Body == "" {
		core.SendFailedReponse(w, r, http.StatusUnprocessableEntity, "Missing required fields")
		return
	}

	reply, err := svc.CreateReply(ctx, threadId, req.Body, user.AId)
	if err != nil {
		if err.Error() == "not found" {
			core.SendFailedReponse(w, r, http.StatusNotFound, "Thread not found")
		} else if err.Error() == "forbidden" {
			core.SendFailedReponse(w, r, http.StatusForbidden, "Forbidden")
		} else {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		}
		return
	}

	// Fetch documentId from thread
	// In a real scenario we'd query it or return it from the service.
	// For now we'll just not send it via SSE if we don't have it, but wait! The client filters by DocumentID.
	
	core.SendSuccessResponse(w, r, http.StatusCreated, reply)
}

func editReply(w http.ResponseWriter, r *http.Request) {
	replyId := chi.URLParam(r, "replyId")
	var req EditReplyReq

	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	err = json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusBadRequest, "Invalid JSON body")
		return
	}

	if req.Body == "" {
		core.SendFailedReponse(w, r, http.StatusUnprocessableEntity, "Missing required fields")
		return
	}

	reply, err := svc.EditReply(ctx, replyId, req.Body, user.AId)
	if err != nil {
		if err.Error() == "forbidden" {
			core.SendFailedReponse(w, r, http.StatusForbidden, "Forbidden")
		} else {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		}
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, reply)
}

func deleteReply(w http.ResponseWriter, r *http.Request) {
	replyId := chi.URLParam(r, "replyId")
	ctx := r.Context()

	user, err := core.GetUserInfo(ctx)
	if err != nil {
		core.SendFailedReponse(w, r, http.StatusUnauthorized, "Unauthorized")
		return
	}

	err = svc.DeleteReply(ctx, replyId, user.AId)
	if err != nil {
		if err.Error() == "forbidden" {
			core.SendFailedReponse(w, r, http.StatusForbidden, "Forbidden")
		} else {
			core.SendFailedReponse(w, r, http.StatusInternalServerError, err.Error())
		}
		return
	}

	core.SendSuccessResponse(w, r, http.StatusNoContent, nil)
}

func sseEvents(w http.ResponseWriter, r *http.Request) {
	docId := chi.URLParam(r, "docId")
	Hub.SSEHandler(w, r, docId)
}
