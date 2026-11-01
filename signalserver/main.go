package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
)

// Client represents a single connected user
type Client struct {
	conn      *websocket.Conn // WebSocket connection
	topics    map[string]bool // topics the client is in
	send      chan []byte     // Outbound messages
	done      chan struct{}
	closeOnce sync.Once
	clientID  string // stable id for deterministic leader election
}

// Hub maintains the set of active clients and broadcasts messages to them
type Hub struct {
	topics        map[string]map[*Client]bool // rooms and clients in them
	topicLeaderID map[string]string           // topic -> current leader clientID (sticky amIleader)
	connections   sync.Map                    // all upgraded clients, including clients with no rooms
	mu            sync.RWMutex                // Mutex for the rooms map
}

type Message struct {
	Type           string   `json:"type"`
	Topics         []string `json:"topics,omitempty"` // For subscribe
	Topic          string   `json:"topic,omitempty"`  // For publish
	Data           any      `json:"data,omitempty"`
	Binary         []byte   `json:"-"`                        // Raw binary data for y-webrtc updates
	IsLeader       bool     `json:"isLeader"`                 // For leader election (explicit false)
	LeaderClientID string   `json:"leaderClientId,omitempty"` // Room leader's stable id
	Clients        int      `json:"clients,omitempty"`        // For publish
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Hello, World!"))
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return isAllowedOrigin(r.Header.Get("Origin")) },
}

func newHub() *Hub {
	return &Hub{
		topics:        make(map[string]map[*Client]bool),
		topicLeaderID: make(map[string]string),
		mu:            sync.RWMutex{},
	}
}

func newClientID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return strings.Repeat("0", 32)
	}
	return hex.EncodeToString(b[:])
}

var hub = newHub()

var sigRedis *redis.Client // nil if SIGNAL_REDIS_URL not set

func initSignalRedis() {
	url := os.Getenv("SIGNAL_REDIS_URL")
	if url == "" {
		log.Println("SIGNAL_REDIS_URL not set — watchdog and room Redis writes disabled")
		return
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		log.Printf("signalserver: invalid SIGNAL_REDIS_URL: %v", err)
		return
	}
	c := redis.NewClient(opts)
	if err := instrumentRedis(c); err != nil {
		log.Printf("signalserver: instrument Redis: %v", err)
		_ = c.Close()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Ping(ctx).Err(); err != nil {
		log.Printf("signalserver: redis ping failed: %v — watchdog disabled", err)
		_ = c.Close()
		return
	}
	sigRedis = c
	log.Println("signalserver: redis connected, watchdog enabled")
}

// parseTopicIDs splits "<pageId>-space-<spaceId>" into its parts.
func parseTopicIDs(topic string) (pageID string, spaceID string, ok bool) {
	parts := strings.SplitN(topic, "-space-", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

const roomKeyTTL = 0 // no expiry — cleaned on unregister when room drains

func redisSetRoomLeader(topic, leaderClientID string) {
	if sigRedis == nil {
		return
	}
	go func() {
		spanCtx, span := otel.Tracer("beskar/signal").Start(context.Background(), "Signal/RedisRoomUpdate")
		defer span.End()
		ctx, cancel := context.WithTimeout(spanCtx, 2*time.Second)
		defer cancel()
		key := "beskar:room:" + topic + ":leader"
		if err := sigRedis.Set(ctx, key, leaderClientID, roomKeyTTL).Err(); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "Redis operation failed")
			signalRequestLogger(ctx).Error("redis set room leader", "error", err)
		}
	}()
}

func redisAddRoomMember(topic, clientID string) {
	if sigRedis == nil {
		return
	}
	go func() {
		spanCtx, span := otel.Tracer("beskar/signal").Start(context.Background(), "Signal/RedisRoomUpdate")
		defer span.End()
		ctx, cancel := context.WithTimeout(spanCtx, 2*time.Second)
		defer cancel()
		key := "beskar:room:" + topic + ":members"
		if err := sigRedis.HSet(ctx, key, clientID, "1").Err(); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "Redis operation failed")
			signalRequestLogger(ctx).Error("redis add room member", "error", err)
		}
	}()
}

func redisRemoveRoomMember(topic, clientID string, topicDrained bool) {
	if sigRedis == nil {
		return
	}
	go func() {
		spanCtx, span := otel.Tracer("beskar/signal").Start(context.Background(), "Signal/RedisRoomUpdate")
		defer span.End()
		ctx, cancel := context.WithTimeout(spanCtx, 2*time.Second)
		defer cancel()
		memberKey := "beskar:room:" + topic + ":members"
		leaderKey := "beskar:room:" + topic + ":leader"
		pipe := sigRedis.Pipeline()
		pipe.HDel(ctx, memberKey, clientID)
		if topicDrained {
			pipe.Del(ctx, memberKey, leaderKey)
		}
		if _, err := pipe.Exec(ctx); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "Redis operation failed")
			signalRequestLogger(ctx).Error("redis remove room member", "error", err)
		}
	}()
}

func watchdogInterval() time.Duration {
	if v := os.Getenv("SIGNAL_WATCHDOG_INTERVAL_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return 15 * time.Second
}

func leaderEvictSec() int64 {
	if v := os.Getenv("SIGNAL_LEADER_EVICT_SEC"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return 90
}

func (h *Hub) startWatchdog(ctx context.Context) {
	if sigRedis == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(watchdogInterval())
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				h.watchdogTick(ctx)
			}
		}
	}()
}

func (h *Hub) watchdogTick(ctx context.Context) {
	ctx, span := otel.Tracer("beskar/signal").Start(ctx, "Signal/Watchdog")
	defer span.End()
	threshold := leaderEvictSec()

	h.mu.RLock()
	snapshot := make(map[string]string, len(h.topicLeaderID))
	for topic, leaderID := range h.topicLeaderID {
		snapshot[topic] = leaderID
	}
	h.mu.RUnlock()

	for topic, leaderClientID := range snapshot {
		pageID, spaceID, ok := parseTopicIDs(topic)
		if !ok {
			continue
		}

		tsKey := fmt.Sprintf("beskar:presence:draft_leader_ts:%s:%s", spaceID, pageID)

		tsStr, err := sigRedis.Get(ctx, tsKey).Result()
		if err != nil {
			if !errors.Is(err, redis.Nil) {
				span.RecordError(err)
				span.SetStatus(codes.Error, "Redis operation failed")
				signalRequestLogger(ctx).Error("watchdog: Redis operation failed", "error", err)
			}
			continue
		}

		lastTS, err := strconv.ParseInt(tsStr, 10, 64)
		if err != nil {
			continue
		}
		if time.Now().Unix()-lastTS < threshold {
			continue
		}

		tsStr2, err := sigRedis.Get(ctx, tsKey).Result()
		if err != nil || tsStr2 != tsStr {
			continue
		}

		h.evictLeader(topic, leaderClientID, pageID, spaceID)
	}
}

func (h *Hub) evictLeader(topic, leaderClientID, pageID, spaceID string) {
	h.mu.RLock()
	clients, ok := h.topics[topic]
	if !ok {
		h.mu.RUnlock()
		return
	}
	var target *Client
	for c := range clients {
		if c.clientID == leaderClientID {
			target = c
			break
		}
	}
	h.mu.RUnlock()

	if target == nil {
		return
	}

	log.Printf("watchdog: evicting stale leader clientID=%s topic=%s", leaderClientID, topic)
	target.conn.Close()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		dedupeKey := fmt.Sprintf("beskar:presence:inactive_emit:%s:%s", spaceID, pageID)
		if err := sigRedis.Del(ctx, dedupeKey).Err(); err != nil {
			log.Printf("watchdog: redis del inactive_emit: %v", err)
		}
	}()
}

func (c *Client) close() {
	c.closeOnce.Do(func() {
		if c.done != nil {
			close(c.done)
		}
		if c.conn != nil {
			_ = c.conn.Close()
		}
	})
}

func (c *Client) enqueue(payload []byte) {
	select {
	case c.send <- payload:
	case <-c.done:
	}
}

func (c *Client) writePump() {
	defer c.close()
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.send:
			mt := websocket.BinaryMessage
			if len(msg) > 0 && msg[0] == '{' {
				mt = websocket.TextMessage
			}
			if err := c.conn.WriteMessage(mt, msg); err != nil {
				return
			}
		}
	}
}

// electLeaderInternal recomputes the leader as the client with the smallest clientID
// (lexicographic). Caller must hold h.mu (write lock).
// requester is set only for "amIleader" handling: when the leader id is unchanged, only
// the requester is notified (reduces churn); subscribe/unregister pass requester == nil
// to always broadcast to everyone in the room.
func (h *Hub) electLeaderInternal(topicName string, requester *Client) {
	// Document v2 rooms persist independently; they have no save leader or watchdog.
	if strings.HasPrefix(topicName, "document-v2:") {
		return
	}
	clients, ok := h.topics[topicName]
	if !ok || len(clients) == 0 {
		delete(h.topicLeaderID, topicName)
		return
	}

	clientsSlice := make([]*Client, 0, len(clients))
	for c := range clients {
		clientsSlice = append(clientsSlice, c)
	}
	slices.SortFunc(clientsSlice, func(a, b *Client) int {
		return strings.Compare(a.clientID, b.clientID)
	})
	leader := clientsSlice[0]
	newLeaderID := leader.clientID

	prev, hadPrev := h.topicLeaderID[topicName]
	h.topicLeaderID[topicName] = newLeaderID

	redisSetRoomLeader(topicName, newLeaderID)

	sendLeader := func(client *Client, isL bool) {
		msg := Message{
			Type:           "leader",
			Topic:          topicName,
			IsLeader:       isL,
			LeaderClientID: newLeaderID,
		}
		payload, _ := json.Marshal(msg)
		select {
		case client.send <- payload:
		default:
		}
	}

	if requester != nil && hadPrev && prev == newLeaderID {
		sendLeader(requester, requester == leader)
		return
	}

	for client := range clients {
		sendLeader(client, client == leader)
	}
}

func (h *Hub) handleUnregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for topic := range c.topics {
		if clients, ok := h.topics[topic]; ok {
			delete(clients, c)
			topicDrained := len(clients) == 0
			redisRemoveRoomMember(topic, c.clientID, topicDrained)

			if topicDrained {
				delete(h.topics, topic)
				delete(h.topicLeaderID, topic)
			} else {
				h.electLeaderInternal(topic, nil)
			}
		}
	}
	c.close()
}

func (c *Client) readPump(h *Hub) {
	defer func() {
		h.connections.Delete(c)
		activeSignalConnections.Add(context.Background(), -1)
		h.handleUnregister(c)
	}()

	for {
		messageType, payload, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		c.processIncomingMessage(h, messageType, payload)
	}
}

func (c *Client) processIncomingMessage(h *Hub, messageType int, payload []byte) {
	started := time.Now()
	ctx, span := otel.Tracer("beskar/signal").Start(context.Background(), "WebSocket/Message")
	defer span.End()
	kind := "unknown"
	if messageType == websocket.BinaryMessage {
		kind = "binary"
	}
	defer func() {
		attrs := attribute.String("message.type", kind)
		span.SetAttributes(attrs)
		signalMessages.Add(context.Background(), 1, metric.WithAttributes(attrs))
		signalMessageDuration.Record(context.Background(), time.Since(started).Seconds(), metric.WithAttributes(attrs))
	}()

	if messageType == websocket.BinaryMessage {
		h.mu.RLock()
		for topicName := range c.topics {
			if clients, ok := h.topics[topicName]; ok {
				for client := range clients {
					if client != c {
						client.enqueue(payload)
					}
				}
			}
		}
		h.mu.RUnlock()
		return
	}

	var msg Message
	if err := json.Unmarshal(payload, &msg); err != nil {
		span.SetStatus(codes.Error, "Invalid message")
		signalRequestLogger(ctx).Warn("Invalid WebSocket message")
		return
	}
	switch msg.Type {
	case "subscribe", "publish", "amIleader", "ping":
		kind = msg.Type
	}

	switch msg.Type {
	case "subscribe":
		h.mu.Lock()
		for _, t := range msg.Topics {
			if h.topics[t] == nil {
				h.topics[t] = make(map[*Client]bool)
			}
			h.topics[t][c] = true
			c.topics[t] = true
			redisAddRoomMember(t, c.clientID)
			h.electLeaderInternal(t, nil)
		}
		h.mu.Unlock()

	case "publish":
		h.mu.RLock()
		if clients, ok := h.topics[msg.Topic]; ok {
			msg.Clients = len(clients)
			resp, _ := json.Marshal(msg)
			for client := range clients {
				if client != c {
					client.enqueue(resp)
				}
			}
		}
		h.mu.RUnlock()

	case "amIleader":
		h.mu.Lock()
		h.electLeaderInternal(msg.Topic, c)
		h.mu.Unlock()
	case "ping":
		pong, _ := json.Marshal(Message{Type: "pong"})
		c.enqueue(pong)
	}
}

func validateSession(r *http.Request) bool {
	authServerURL := os.Getenv("AUTH_SERVER_URL")
	if authServerURL == "" {
		log.Println("AUTH_SERVER_URL not set, skipping auth check")
		return false
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", authServerURL+"/api/v1/authenticated", nil)
	if err != nil {
		log.Println("auth: failed to build validation request:", err)
		return false
	}

	for _, cookie := range r.Cookies() {
		req.AddCookie(cookie)
	}

	token := r.Header.Get("Authorization")
	if token == "" {
		queryToken := r.URL.Query().Get("token")
		if queryToken != "" {
			token = "Bearer " + queryToken
		}
	}
	if token != "" {
		req.Header.Set("Authorization", token)
		log.Println("auth: Found token, sending to validation server")
	} else {
		log.Println("auth: No token found in headers or query params")
	}

	log.Printf("auth: Making request to %s", req.URL.String())
	resp, err := signalHTTPClient.Do(req)
	if err != nil {
		log.Println("auth: validation request failed:", err)
		return false
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("auth: validation failed with status %d", resp.StatusCode)
	} else {
		log.Println("auth: validation succeeded!")
	}

	return resp.StatusCode == http.StatusOK
}

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
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("Failed to upgrade to WebSocket:", err)
		return
	}
	client := &Client{
		conn:     conn,
		topics:   make(map[string]bool),
		send:     make(chan []byte, 2048),
		clientID: newClientID(),
		done:     make(chan struct{}),
	}
	hub.connections.Store(client, struct{}{})
	activeSignalConnections.Add(context.Background(), 1)
	go client.writePump()
	go client.readPump(hub)
}

func allowedOrigins() []string {
	raw := os.Getenv("CORS_ALLOWED_ORIGINS")
	if raw == "" {
		return []string{"http://localhost:3000", "http://localhost:8085"}
	}

	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		origins = append(origins, trimmed)
	}

	if len(origins) == 0 {
		return []string{"http://localhost:3000", "http://localhost:8085"}
	}

	return origins
}

func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}

	requestOrigin, err := url.Parse(origin)
	if err != nil {
		return false
	}

	for _, candidate := range allowedOrigins() {
		if origin == candidate {
			return true
		}

		if strings.Contains(candidate, "*.") {
			patternOrigin, err := url.Parse(candidate)
			if err != nil || patternOrigin.Scheme != requestOrigin.Scheme {
				continue
			}

			prefix := "*."
			suffix := strings.TrimPrefix(patternOrigin.Hostname(), prefix)
			host := requestOrigin.Hostname()
			if suffix != "" && strings.HasSuffix(host, "."+suffix) {
				return true
			}
		}
	}

	return false
}

func setupRoutes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", handleRoot)
	mux.Handle("/ws", signalHTTPHandler(http.HandlerFunc(authMiddleware(handleWebSocket)), "GET /ws"))
	return mux
}

func runSignalServer(ctx context.Context) error {
	shutdownTelemetry, err := initTelemetry(ctx, "beskar-signal")
	if err != nil {
		return err
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := shutdownTelemetry(shutdownCtx); err != nil {
			log.Printf("OpenTelemetry shutdown: %v", err)
		}
	}()
	appCtx, cancelApp := context.WithCancel(ctx)
	defer cancelApp()
	initSignalRedis()
	if sigRedis != nil {
		defer sigRedis.Close()
	}
	hub.startWatchdog(appCtx)
	srv := &http.Server{Addr: ":8080", Handler: setupRoutes()}
	serveErrors := make(chan error, 1)
	go func() { serveErrors <- srv.ListenAndServe() }()
	log.Println("Starting server on port 8080")
	select {
	case <-ctx.Done():
	case err := <-serveErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	cancelApp()
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	// Stop accepting HTTP handshakes before closing all upgraded connections.
	shutdownError := srv.Shutdown(shutdownCtx)
	hub.connections.Range(func(key, value any) bool { key.(*Client).close(); return true })
	return shutdownError
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := runSignalServer(ctx); err != nil {
		log.Printf("signalserver: %v", err)
		os.Exit(1)
	}
}
