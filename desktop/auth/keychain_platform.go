//go:build !darwin

package auth

import "github.com/zalando/go-keyring"

// Windows Credential Manager and Linux Secret Service retain their OS-user
// protection. Per-application sandbox/installer access needs platform validation.
type platformSecrets struct{}

func nativeSecretBackend() secretBackend                { return platformSecrets{} }
func (platformSecrets) Get(s, a string) (string, error) { return keyring.Get(s, a) }
func (platformSecrets) Set(s, a, v string) error        { return keyring.Set(s, a, v) }
func (platformSecrets) Delete(s, a string) error        { return keyring.Delete(s, a) }
