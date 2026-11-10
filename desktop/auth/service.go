package auth

import "context"

// uiAuthManager is the nonsecret subset needed by the renderer facade.
type uiAuthManager interface {
	Login(context.Context) error
	Logout() error
	IsAuthenticated() bool
	GetStatus() Status
}

// UIAuthService is the complete renderer-facing authentication API. Do not embed
// Manager here: embedding would promote its sensitive methods into Wails IPC.
type UIAuthService struct {
	manager uiAuthManager
}

func NewUIAuthService(manager *Manager) *UIAuthService {
	return &UIAuthService{manager: manager}
}

func (s *UIAuthService) Login(ctx context.Context) error { return s.manager.Login(ctx) }

func (s *UIAuthService) Logout() error { return s.manager.Logout() }

func (s *UIAuthService) IsAuthenticated() bool { return s.manager.IsAuthenticated() }

func (s *UIAuthService) GetStatus() Status { return s.manager.GetStatus() }
