package auth

import (
	"encoding/json"
	"time"

	"github.com/zalando/go-keyring"
)

const serviceName = "Beskar"
const accountName = "user_tokens"

// TokenStore represents the tokens stored in the OS keychain.
type TokenStore struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	IDToken      string    `json:"id_token"`
	Expiry       time.Time `json:"expiry"`
}

// SaveTokens stores the tokens in the OS keychain.
func SaveTokens(store TokenStore) error {
	data, err := json.Marshal(store)
	if err != nil {
		return err
	}
	return keyring.Set(serviceName, accountName, string(data))
}

// LoadTokens retrieves the tokens from the OS keychain.
func LoadTokens() (TokenStore, error) {
	var store TokenStore
	data, err := keyring.Get(serviceName, accountName)
	if err != nil {
		return store, err
	}
	err = json.Unmarshal([]byte(data), &store)
	return store, err
}

// ClearTokens removes the tokens from the OS keychain.
func ClearTokens() error {
	return keyring.Delete(serviceName, accountName)
}
