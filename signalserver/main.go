package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/websocket"
)

// Client represents a single connected user
type Client struct {
	conn   *websocket.Conn // WebSocket connection
	topics map[string]bool // topics the client is in
	send   chan []byte     // Outbound messages
}

// Hub maintains the set of active clients and broadcasts messages to them
type Hub struct {
	topics map[string]map[*Client]bool // rooms and clients in them
	mu     sync.RWMutex                // Mutex for the rooms map
}

type Message struct {
	Type     string   `json:"type"`
	Topics   []string `json:"topics,omitempty"` // For subscribe
	Topic    string   `json:"topic,omitempty"`  // For publish
	Data     any      `json:"data,omitempty"`
	Binary   []byte   `json:"-"`                  // Raw binary data for y-webrtc updates
	IsLeader bool     `json:"isLeader,omitempty"` // For leader election
	Clients  int      `json:"clients,omitempty"`  // For publish
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Hello, World!"))
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

func newHub() *Hub {
	return &Hub{
		topics: make(map[string]map[*Client]bool),
		mu:     sync.RWMutex{},
	}
}

var hub = newHub()

func (c *Client) writePump() {
	for msg := range c.send {
		// Determine if message is JSON or Binary based on first byte
		// or pass the type through the channel.
		// Simplest for Yjs: if it starts with '{', it's Text.
		mt := websocket.BinaryMessage
		if len(msg) > 0 && msg[0] == '{' {
			mt = websocket.TextMessage
		}
		c.conn.WriteMessage(mt, msg)
	}
}

func (h *Hub) electLeaderInternal(topicName string) {
	clients, ok := h.topics[topicName]
	if !ok || len(clients) == 0 {
		return
	}

	// 1. Determine the leader (e.g., the "oldest" or simply the first in the map)
	var leader *Client
	for c := range clients {
		leader = c
		break
	}

	// 2. Notify all clients in the room of the current leader state
	for client := range clients {
		msg := Message{
			Type:     "leader",
			Topic:    topicName,
			IsLeader: (client == leader),
		}
		payload, _ := json.Marshal(msg)

		// Send to the client's channel (non-blocking)
		select {
		case client.send <- payload:
		default:
			// If buffer is full, we'll handle this in the unregister logic
		}
	}
}

func (h *Hub) handleUnregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for topic := range c.topics {
		if clients, ok := h.topics[topic]; ok {
			delete(clients, c) // 2. Remove the leaver

			if len(clients) == 0 {
				delete(h.topics, topic)
			} else {
				// 3. Pick a new leader from the REMAINING clients
				// This is safe because we are still under h.mu.Lock()
				h.electLeaderInternal(topic)
			}
		}
	}
	c.conn.Close()
}

func (c *Client) readPump(h *Hub) {
	defer func() {
		h.handleUnregister(c)
	}()

	for {
		messageType, payload, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		// Handle Binary (Yjs Updates)
		if messageType == websocket.BinaryMessage {
			h.mu.RLock()
			for topicName := range c.topics {
				if clients, ok := h.topics[topicName]; ok {
					for client := range clients {
						if client != c {
							client.send <- payload
						}
					}
				}
			}
			h.mu.RUnlock()
			continue
		}

		// Handle JSON Signaling
		var msg Message
		if err := json.Unmarshal(payload, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "subscribe":
			h.mu.Lock()
			for _, t := range msg.Topics {
				fmt.Println("topics", h.topics)
				if h.topics[t] == nil {
					h.topics[t] = make(map[*Client]bool)
				}
				h.topics[t][c] = true
				c.topics[t] = true
				h.electLeaderInternal(t)
			}
			h.mu.Unlock()

		case "publish":
			h.mu.RLock()
			if clients, ok := h.topics[msg.Topic]; ok {
				msg.Clients = len(clients)
				fmt.Println("topics", h.topics)
				fmt.Println("publish message", msg)
				fmt.Println("clients length", len(clients))
				resp, _ := json.Marshal(msg)
				for client := range clients {
					if client != c {
						client.send <- resp
					}
				}
			}
			h.mu.RUnlock()

		case "amIleader":
			h.mu.Lock()
			h.electLeaderInternal(msg.Topic)
			h.mu.Unlock()
		case "ping":
			pong, _ := json.Marshal(Message{Type: "pong"})
			c.send <- pong
		}
	}
}

// validateSession forwards the request cookies to the main API server and
// checks whether the session is authenticated. This delegates the Zitadel
// cookie decryption to the server that already has the KEY configured.
func validateSession(r *http.Request) bool {
	authServerURL := os.Getenv("AUTH_SERVER_URL") // e.g. http://server:9095
	if authServerURL == "" {
		log.Println("AUTH_SERVER_URL not set, skipping auth check")
		return false
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", authServerURL+"/api/v1/authenticated", nil)
	if err != nil {
		log.Println("auth: failed to build validation request:", err)
		return false
	}

	// Forward all cookies from the original WS upgrade request
	for _, cookie := range r.Cookies() {
		req.AddCookie(cookie)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Println("auth: validation request failed:", err)
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK
}

// authMiddleware validates the session before the WebSocket upgrade.
// Unauthenticated requests receive a plain HTTP 401 response.
func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validateSession(r) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// to prevent cross-origin requests
	upgrader.CheckOrigin = func(r *http.Request) bool {
		return true // TODO: Implement proper CORS checking
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Failed to upgrade to WebSocket:", err)
		return
	}
	client := &Client{
		conn:   conn,
		topics: make(map[string]bool),
		send:   make(chan []byte),
	}
	go client.writePump()
	go client.readPump(hub)
}

func setupRoutes() {
	http.HandleFunc("/", handleRoot)
	http.HandleFunc("/ws", authMiddleware(handleWebSocket))
}

func main() {
	setupRoutes()
	log.Println("Starting server on port 8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
