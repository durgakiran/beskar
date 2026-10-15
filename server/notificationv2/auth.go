package notificationv2

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"unicode"

	"github.com/google/uuid"
)

// Producer credentials are dedicated service tokens, not browser or OIDC tokens.
// Store SHA-256 digests of high-entropy tokens in server configuration; clients
// hold the original tokens. Multiple tokens may map to a source for rotation.
type credentialConfig struct {
	Source      string    `json:"source"`
	ActorID     uuid.UUID `json:"actor_id"`
	TokenSHA256 string    `json:"token_sha256"`
}
type credential struct {
	producer Producer
	hash     [32]byte
}

func validateProducer(p Producer) error {
	if p.ActorID == uuid.Nil || p.Source == "" || len(p.Source) > 200 || p.Source != strings.TrimSpace(p.Source) || strings.IndexFunc(p.Source, unicode.IsControl) >= 0 {
		return &apiError{http.StatusForbidden, "invalid notification producer"}
	}
	return nil
}

// LoadProducerResolver reads NOTIFICATION_V2_PRODUCERS once at startup.
// Empty configuration disables HTTP access while direct Go calls remain usable.
func LoadProducerResolver() (ProducerResolver, error) {
	return ParseProducerCredentials(os.Getenv("NOTIFICATION_V2_PRODUCERS"))
}
func ParseProducerCredentials(config string) (ProducerResolver, error) {
	var entries []credentialConfig
	if strings.TrimSpace(config) != "" {
		decoder := json.NewDecoder(strings.NewReader(config))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&entries); err != nil {
			return nil, fmt.Errorf("invalid NOTIFICATION_V2_PRODUCERS JSON")
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			return nil, fmt.Errorf("NOTIFICATION_V2_PRODUCERS must contain one JSON array")
		}
	}
	if len(entries) > 100 {
		return nil, fmt.Errorf("at most 100 notification producer credentials are supported")
	}
	seen := map[[32]byte]bool{}
	credentials := make([]credential, 0, len(entries))
	for i, entry := range entries {
		p := Producer{Source: entry.Source, ActorID: entry.ActorID}
		if validateProducer(p) != nil {
			return nil, fmt.Errorf("invalid producer identity at entry %d", i)
		}
		raw, err := hex.DecodeString(entry.TokenSHA256)
		if err != nil || len(raw) != sha256.Size {
			return nil, fmt.Errorf("invalid SHA-256 token digest at entry %d", i)
		}
		var digest [32]byte
		copy(digest[:], raw)
		if seen[digest] {
			return nil, fmt.Errorf("duplicate producer credential at entry %d", i)
		}
		seen[digest] = true
		credentials = append(credentials, credential{p, digest})
	}
	return func(r *http.Request) (Producer, error) {
		if len(credentials) == 0 {
			return Producer{}, &apiError{http.StatusServiceUnavailable, "notification producer HTTP access is not configured"}
		}
		values := r.Header.Values("Authorization")
		if len(values) != 1 {
			return Producer{}, &apiError{http.StatusUnauthorized, "producer bearer credential required"}
		}
		parts := strings.Fields(values[0])
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || len(parts[1]) < 32 || len(parts[1]) > 512 {
			return Producer{}, &apiError{http.StatusUnauthorized, "invalid producer bearer credential"}
		}
		digest := sha256.Sum256([]byte(parts[1]))
		var p Producer
		matched := false
		for _, entry := range credentials {
			if subtle.ConstantTimeCompare(digest[:], entry.hash[:]) == 1 {
				p = entry.producer
				matched = true
			}
		}
		if !matched {
			return Producer{}, &apiError{http.StatusUnauthorized, "invalid producer bearer credential"}
		}
		return p, nil
	}, nil
}
