package page

type Crumb struct {
	Name     string `json:"name" db:"title"`
	Id       int64  `json:"id" db:"id"`
	ParentId int64  `json:"parentId" db:"parent_id"`
}
