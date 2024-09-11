package invite

import (
	"testing"

	"github.com/google/uuid"
)

func TestHashFunction(t *testing.T) {
	var i Invite
	i.Entity = "space"
	i.EntityId = "1"
	i.SenderId = uuid.New()
	i.UserId = uuid.New()
	tkn := i.token()
	if tkn == "" {
		t.Error("couldn't generate token")
	}
}
