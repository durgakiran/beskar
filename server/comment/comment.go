package comment

import "github.com/go-chi/chi/v5"

func Router() *chi.Mux {
	r := chi.NewRouter()

	r.Get("/documents/{docId}/threads", listThreads)
	r.Post("/documents/{docId}/threads", createThread)
	r.Get("/documents/{docId}/events", sseEvents)

	r.Patch("/threads/{threadId}/resolve", resolveThread)
	r.Patch("/threads/{threadId}/unresolve", unresolveThread)
	r.Patch("/threads/{threadId}/orphan", orphanThread)
	r.Delete("/threads/{threadId}", deleteThread)
	r.Post("/threads/{threadId}/replies", createReply)

	r.Patch("/replies/{replyId}", editReply)
	r.Delete("/replies/{replyId}", deleteReply)

	return r
}
