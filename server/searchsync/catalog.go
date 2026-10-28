package searchsync

// IDs are persisted in search_sync lookup tables. Keep values stable and add
// new catalog entries through Liquibase before deploying producers that use them.
type ReasonID int16

const (
	ReasonDocumentCreated   ReasonID = 1
	ReasonDocumentPublished ReasonID = 2
	ReasonDocumentDeleted   ReasonID = 3
	ReasonSpaceArchived     ReasonID = 4
	ReasonSpaceUnarchived   ReasonID = 5
	ReasonSpaceDeleted      ReasonID = 6
	ReasonBackfill          ReasonID = 7
	ReasonReconcile         ReasonID = 8
)

type StatusID int16

const (
	StatusPending   StatusID = 1
	StatusCompleted StatusID = 2
	StatusFailed    StatusID = 3
)
