package user

type SearchUser struct {
	Search string `json:"search"`
	Limit  uint32 `json:"limit"`
	Offset uint64 `json:"offset"`
}
