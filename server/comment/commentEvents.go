package comment

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type EventType string

const (
	EventThreadCreated   EventType = "thread:created"
	EventThreadResolved  EventType = "thread:resolved"
	EventThreadUnresoled EventType = "thread:unresolved"
	EventThreadOrphaned  EventType = "thread:orphaned"
	EventThreadDeleted   EventType = "thread:deleted"
	EventReplyCreated    EventType = "reply:created"
	EventReplyEdited     EventType = "reply:edited"
	EventReplyDeleted    EventType = "reply:deleted"
)

type CommentEvent struct {
	Type       EventType   `json:"type"`
	DocumentID string      `json:"documentId"`
	Payload    interface{} `json:"payload"`
}

type Client struct {
	documentID string
	channel    chan []byte
}

type EventHub struct {
	sync.RWMutex
	clients    map[*Client]bool
	broadcast  chan CommentEvent
	register   chan *Client
	unregister chan *Client
}

var Hub *EventHub

func init() {
	Hub = &EventHub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan CommentEvent),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
	go Hub.run()
}

func (h *EventHub) run() {
	for {
		select {
		case client := <-h.register:
			h.Lock()
			h.clients[client] = true
			h.Unlock()
		case client := <-h.unregister:
			h.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.channel)
			}
			h.Unlock()
		case event := <-h.broadcast:
			payload, err := json.Marshal(event)
			if err != nil {
				continue
			}
			msg := []byte(fmt.Sprintf("data: %s\n\n", payload))

			h.RLock()
			for client := range h.clients {
				if client.documentID == event.DocumentID {
					select {
					case client.channel <- msg:
					default:
						// If channel buffer is full, drop client to prevent blocking
						h.RUnlock()
						h.unregister <- client
						h.RLock()
					}
				}
			}
			h.RUnlock()
		}
	}
}

func (h *EventHub) Publish(eventType EventType, documentID string, payload interface{}) {
	h.broadcast <- CommentEvent{
		Type:       eventType,
		DocumentID: documentID,
		Payload:    payload,
	}
}

// Handler handles SSE connections
func (h *EventHub) SSEHandler(w http.ResponseWriter, r *http.Request, docId string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	client := &Client{
		documentID: docId,
		channel:    make(chan []byte, 256), // Buffer
	}

	h.register <- client
	defer func() {
		h.unregister <- client
	}()

	// Send initial ping to establish connection
	fmt.Fprintf(w, ": ping\n\n")
	flusher.Flush()

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-client.channel:
			if !ok {
				return
			}
			if _, err := w.Write(msg); err != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprintf(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
