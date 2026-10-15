package notificationv2

import "github.com/google/uuid"

// Published by notifications_v2_business.xml; immutable version 1.
var businessTemplates = map[string]uuid.UUID{
	"space_invite_created":      uuid.MustParse("70577944-03a0-5fc3-8620-8848a172b09f"),
	"space_invite_accepted":     uuid.MustParse("60d547d1-6137-5aa2-9dea-e95d4cd400b9"),
	"space_invite_declined":     uuid.MustParse("614c81de-40c0-5103-9ab1-bc14ac1b9518"),
	"space_member_added":        uuid.MustParse("63b06aa6-0e50-55eb-859d-2ed3af178825"),
	"space_member_removed":      uuid.MustParse("99008bc1-709b-5032-bca6-d05625877392"),
	"space_member_role_changed": uuid.MustParse("ebca3c8f-2eb6-5a14-b67d-918e2ee5193b"),
	"space_archived":            uuid.MustParse("74648d9d-2118-5c41-9583-43b559888ac4"),
	"space_unarchived":          uuid.MustParse("44ab226d-6d72-5ec7-a9b6-c677b110027b"),
	"space_deleted":             uuid.MustParse("a463d51b-6e72-58b9-9f37-61fffa5da056"),
}
var businessEmailTemplate = uuid.MustParse("88826b8f-ac84-544a-9980-3a1ef9410bc1")
