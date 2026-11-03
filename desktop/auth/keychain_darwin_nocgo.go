//go:build darwin && !cgo

package auth

import "errors"

type unavailableSecrets struct{}

func nativeSecretBackend() secretBackend { return unavailableSecrets{} }
func (unavailableSecrets) Get(string, string) (string, error) {
	return "", errors.New("native keychain requires CGO")
}
func (unavailableSecrets) Set(string, string, string) error {
	return errors.New("native keychain requires CGO")
}
func (unavailableSecrets) Delete(string, string) error {
	return errors.New("native keychain requires CGO")
}
