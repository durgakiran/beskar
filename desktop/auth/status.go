package auth

import "strings"

// Status is the entire nonsecret diagnostic contract for the renderer. It must
// never contain tokens, account claims, provider payloads, URLs or raw errors.
type Status struct {
	Code           string `json:"code"`
	Message        string `json:"message"`
	RequiresSignIn bool   `json:"requiresSignIn"`
	LocalSignedOut bool   `json:"localSignedOut"`
	Revocation     string `json:"revocation"` // not_requested, confirmed, unconfirmed
}

func (s *Manager) GetStatus() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *Manager) reportStatus(generation uint64, status Status) {
	s.mu.Lock()
	if s.generation != generation {
		s.mu.Unlock()
		return
	}
	s.status = status
	s.mu.Unlock()
	s.emitForSession("auth:status", generation)
}

func signedOutStatus(code, message string) Status {
	return Status{Code: code, Message: message, RequiresSignIn: true, LocalSignedOut: true, Revocation: "not_requested"}
}

func storageStatus(code, message string, clearErr error) Status {
	if clearErr != nil {
		message += " Saved credentials could not be removed. Check your operating system credential store before restarting the app."
	}
	return signedOutStatus(code, message)
}

// Revocation may finish after a fresh login. Keep that failure visible as a
// warning about the previous session, without marking the new session logged out.
func (s *Manager) reportLogoutResult(generation uint64, result Status) {
	s.mu.Lock()
	if generation != s.generation {
		if result.Revocation != "unconfirmed" {
			s.mu.Unlock()
			return
		}
		warning := "The previous session's token revocation could not be confirmed; its tokens may remain valid until they expire."
		current := s.status
		if current.Message == "" {
			current.Code = "previous_revocation_unconfirmed"
			current.Message = warning
		} else if !strings.Contains(current.Message, warning) {
			current.Message += " " + warning
		}
		s.status = current
	} else {
		s.status = result
	}
	generation = s.generation
	s.mu.Unlock()
	s.emitForSession("auth:status", generation)
}
