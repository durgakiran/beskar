package core

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"github.com/zitadel/zitadel-go/v3/pkg/authentication"
	"golang.org/x/oauth2"
)

var errBrowserStoreUnavailable = errors.New("browser session storage unavailable")

const browserRedisPrefix = "beskar:auth:v1:"
const browserSessionLease = 30 * time.Second

// Explicit wire fields avoid serializing SDK embedding/custom JSON behavior.
type browserSessionRecord struct {
	UserInfo   *oidc.UserInfo      `json:"user_info"`
	Token      *oauth2.Token       `json:"token"`
	IDToken    string              `json:"id_token"`
	IDClaims   *oidc.IDTokenClaims `json:"id_claims"`
	Created    time.Time           `json:"created"`
	LastSeen   time.Time           `json:"last_seen"`
	RetryAfter time.Time           `json:"retry_after"`
	Refreshing bool                `json:"refreshing"`
	LoggingOut bool                `json:"logging_out"`
}
type redisBrowserSessions struct {
	client     *redis.Client
	encryption cipher.AEAD
	lease      time.Duration
}

// InitializeBrowserSessions must precede construction of the authenticator and
// validator. Failure is fatal at startup; there is no local-memory fallback.
func InitializeBrowserSessions(ctx context.Context) (func(), error) {
	opts, err := browserRedisOptions()
	if err != nil {
		return nil, err
	}
	idle, err := browserSessionDuration("BROWSER_SESSION_IDLE_TIMEOUT", 30*time.Minute)
	if err != nil {
		return nil, err
	}
	absolute, err := browserSessionDuration("BROWSER_SESSION_ABSOLUTE_TIMEOUT", 8*time.Hour)
	if err != nil {
		return nil, err
	}
	if idle > absolute {
		return nil, errors.New("browser session idle timeout must not exceed absolute timeout")
	}
	client := redis.NewClient(opts)
	store, err := newRedisBrowserSessionStore(client, os.Getenv("KEY"), idle, absolute)
	if err != nil {
		_ = client.Close()
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if client.Ping(pingCtx).Err() != nil {
		_ = client.Close()
		return nil, errBrowserStoreUnavailable
	}
	browserSessions = store
	return func() { _ = client.Close() }, nil
}
func browserRedisOptions() (*redis.Options, error) {
	var opts *redis.Options
	address := strings.TrimSpace(os.Getenv("REDIS_ADDR"))
	if address != "" {
		var err error
		opts, err = redis.ParseURL(address) // Supports redis:// and rediss://.
		if err != nil {
			return nil, errors.New("REDIS_ADDR must be a valid redis:// or rediss:// URL")
		}
	} else {
		host := strings.TrimSpace(os.Getenv("REDIS_HOST"))
		if host == "" {
			return nil, errors.New("browser sessions require REDIS_ADDR or REDIS_HOST")
		}
		port := strings.TrimSpace(os.Getenv("REDIS_PORT"))
		if port == "" {
			port = "6379"
		}
		opts = &redis.Options{Addr: net.JoinHostPort(host, port), Username: os.Getenv("REDIS_USERNAME"), Password: os.Getenv("REDIS_PASSWORD")}
	}
	opts.DialTimeout = 2 * time.Second
	opts.ReadTimeout = 2 * time.Second
	opts.WriteTimeout = 2 * time.Second
	opts.ContextTimeoutEnabled = true
	// Do not replay session mutations after an ambiguous network failure.
	opts.MaxRetries = -1
	return opts, nil
}
func browserSessionDuration(name string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback, nil
	}
	duration, err := time.ParseDuration(value)
	if err != nil || duration < time.Second {
		return 0, errors.New(name + " must be a duration of at least 1s")
	}
	return duration, nil
}
func newRedisBrowserSessionStore(client *redis.Client, key string, idle, absolute time.Duration) (*browserSessionStore, error) {
	if len(key) != 32 {
		return nil, errors.New("KEY must contain exactly 32 bytes for browser session encryption")
	}
	// Domain-separated derivation: never use the SDK cookie AES key directly for GCM.
	derived := sha256.Sum256([]byte("beskar:redis-session:v1\x00" + key))
	block, err := aes.NewCipher(derived[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &browserSessionStore{backend: &redisBrowserSessions{client: client, encryption: aead, lease: browserSessionLease}, idle: idle, absolute: absolute, now: time.Now}, nil
}
func browserRedisKeys(id string) (string, string) {
	digest := sha256.Sum256([]byte(id))
	base := browserRedisPrefix + "{" + hex.EncodeToString(digest[:]) + "}"
	return base + ":session", base + ":lease"
}
func (b *redisBrowserSessions) seal(key string, e *browserSession) (string, error) {
	if e.session == nil || e.session.Tokens == nil || e.session.Tokens.Token == nil || e.session.UserInfo == nil {
		return "", errBrowserTokenInvalid
	}
	record := browserSessionRecord{UserInfo: e.session.UserInfo, Token: e.session.Tokens.Token, IDToken: e.session.Tokens.IDToken, IDClaims: e.session.Tokens.IDTokenClaims, Created: e.created, LastSeen: e.lastSeen, RetryAfter: e.retryAfter, Refreshing: e.refreshing, LoggingOut: e.loggingOut}
	plaintext, err := json.Marshal(record)
	if err != nil {
		return "", errBrowserStoreUnavailable
	}
	nonce := make([]byte, b.encryption.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", errBrowserStoreUnavailable
	}
	encrypted := b.encryption.Seal(nonce, nonce, plaintext, []byte(key))
	return base64.RawStdEncoding.EncodeToString(encrypted), nil
}
func (b *redisBrowserSessions) open(key, encrypted string) (*browserSession, error) {
	raw, err := base64.RawStdEncoding.DecodeString(encrypted)
	if err != nil || len(raw) < b.encryption.NonceSize() {
		return nil, errBrowserStoreUnavailable
	}
	plaintext, err := b.encryption.Open(nil, raw[:b.encryption.NonceSize()], raw[b.encryption.NonceSize():], []byte(key))
	if err != nil {
		return nil, errBrowserStoreUnavailable
	}
	var record browserSessionRecord
	if json.Unmarshal(plaintext, &record) != nil || record.Token == nil || record.UserInfo == nil {
		return nil, errBrowserStoreUnavailable
	}
	return &browserSession{session: &browserAuthContext{UserInfo: record.UserInfo, Tokens: &oidc.Tokens[*oidc.IDTokenClaims]{Token: record.Token, IDToken: record.IDToken, IDTokenClaims: record.IDClaims}}, created: record.Created, lastSeen: record.LastSeen, retryAfter: record.RetryAfter, refreshing: record.Refreshing, loggingOut: record.LoggingOut}, nil
}
func (s *browserSessionStore) ttl(e *browserSession) time.Duration {
	deadline := e.created.Add(s.absolute)
	if idle := e.lastSeen.Add(s.idle); idle.Before(deadline) {
		deadline = idle
	}
	return deadline.Sub(s.now())
}
func (b *redisBrowserSessions) create(id string, e *browserSession, s *browserSessionStore) error {
	key, _ := browserRedisKeys(id)
	encrypted, err := b.seal(key, e)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ok, err := b.client.SetNX(ctx, key, encrypted, s.ttl(e)).Result()
	if err != nil || !ok {
		return errBrowserStoreUnavailable
	}
	return nil
}
func (b *redisBrowserSessions) get(id string, s *browserSessionStore) (*browserAuthContext, error) {
	key, _ := browserRedisKeys(id)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	value, err := b.client.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return nil, authentication.ErrNoSession
	}
	if err != nil {
		return nil, errBrowserStoreUnavailable
	}
	e, err := b.open(key, value)
	if err != nil {
		return nil, err
	}
	if s.expired(e, s.now()) {
		return nil, authentication.ErrNoSession
	}
	return e.session, nil
}
func (b *redisBrowserSessions) delete(id string) error {
	key, _ := browserRedisKeys(id)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if b.client.Del(ctx, key).Err() != nil {
		return errBrowserStoreUnavailable
	}
	return nil
}

// Lease ownership AND the prior encrypted value are checked on every write.
// Missing/expired/deleted sessions cannot be recreated by a delayed worker.
var saveBrowserSession = redis.NewScript(`
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return -1 end
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if current ~= ARGV[2] then return -1 end
if ARGV[3] == '' then redis.call('DEL', KEYS[1]); return 1 end
redis.call('PSETEX', KEYS[1], ARGV[4], ARGV[3])
return 1
`)
var releaseBrowserSession = redis.NewScript(`if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0`)

func (b *redisBrowserSessions) withSession(ctx context.Context, id string, s *browserSessionStore, fn func(*browserSession, func() error) error) error {
	key, lock := browserRedisKeys(id)
	ownerBytes := make([]byte, 32)
	if _, err := rand.Read(ownerBytes); err != nil {
		return errBrowserStoreUnavailable
	}
	owner := hex.EncodeToString(ownerBytes)
	waitCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	for {
		acquired, err := b.client.SetNX(waitCtx, lock, owner, b.lease).Result()
		if err != nil {
			return errBrowserStoreUnavailable
		}
		if acquired {
			break
		}
		select {
		case <-waitCtx.Done():
			return errBrowserStoreUnavailable
		case <-time.After(25 * time.Millisecond):
		}
	}
	defer func() {
		releaseCtx, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		_ = releaseBrowserSession.Run(releaseCtx, b.client, []string{lock}, owner).Err()
	}()
	previous, err := b.client.Get(waitCtx, key).Result()
	if errors.Is(err, redis.Nil) {
		return errBrowserTokenInvalid
	}
	if err != nil {
		return errBrowserStoreUnavailable
	}
	e, err := b.open(key, previous)
	if err != nil {
		return err
	}
	checkpoint := func() error {
		encrypted := ""
		ttl := s.ttl(e)
		if e.session != nil && ttl >= time.Millisecond {
			var err error
			encrypted, err = b.seal(key, e)
			if err != nil {
				return err
			}
		}
		// Persist a completed rotation even if its browser request was canceled.
		saveCtx, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		result, err := saveBrowserSession.Run(saveCtx, b.client, []string{key, lock}, owner, previous, encrypted, ttl.Milliseconds()).Int()
		if err != nil || result < 0 {
			return errBrowserStoreUnavailable
		}
		if result == 0 {
			return errBrowserTokenInvalid
		}
		previous = encrypted
		if encrypted == "" {
			return errBrowserTokenInvalid
		}
		return nil
	}
	result := fn(e, checkpoint)
	if err := checkpoint(); err != nil {
		return err
	}
	return result
}
