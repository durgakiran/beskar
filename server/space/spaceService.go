package space

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Space) Create(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var spaceId uuid.UUID
	err := conn.QueryRow(ctx, INSERT_SPACE, s.Name, s.DateCreated, s.DateUpdated, s.CreatedBy).Scan(&spaceId)
	if err != nil {
		logger().Error(err.Error())
		return uuid.Nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_INSERTING_ROWS])
	}
	return spaceId, nil
}

func (s Space) Update() {}

func (s Space) Delete() {}

func createSpaceEntry(s Space) (uuid.UUID, error) {
	var spaceId uuid.UUID
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error("Unable to acquire a connection: " + err.Error())
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		// error while acquiring database connection
		logger().Error(err.Error())
		defer conn.Release()
		return spaceId, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer tx.Rollback(ctx)
	defer conn.Release()
	s.DateCreated = time.Now()
	s.DateUpdated = time.Now()
	spaceId, err = s.Create(tx, ctx)
	// create entry in permission system
	err = core.WriteRelations(spaceId.String(), "space", s.CreatedBy.String(), "user", "owner")
	if err != nil {
		logger().Error(err.Error())
		return spaceId, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	tx.Commit(ctx)
	return spaceId, nil
}

func ListSpaces(userId uuid.UUID) ([]Space, error) {
	var spaces []Space
	spaceIds := make([]string, 0)
	spaceIds, err := core.GetEntitiesWithPermission("space", "user", userId.String(), "view")
	if err != nil {
		// return error
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	if len(spaceIds) == 0 {
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA])
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error("Unable to acquire a connection: " + err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()

	rows, err := conn.Query(ctx, GET_SPACES, spaceIds)
	if err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	for rows.Next() {
		var r Space
		err := rows.Scan(&r.Id, &r.Name, &r.DateCreated, &r.DateUpdated, &r.CreatedBy)
		if err != nil {
			logger().Error(err.Error())
			return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
		}
		spaces = append(spaces, r)
	}
	if err = rows.Err(); err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	return spaces, nil
}

func getDocumentList(spaceId uuid.UUID, userId uuid.UUID) ([]PageList, error) {
	var pageList []PageList
	pageIds, err := core.GetEntitiesWithPermission("page", "space", spaceId.String(), "space")
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	if len(pageIds) == 0 {
		return pageList, nil
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, GET_PAGE_LIST_QUERY, spaceId, pageIds)
	defer rows.Close()
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	pageList, err = pgx.CollectRows[PageList](rows, pgx.RowToStructByNameLax[PageList])
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	return pageList, nil
}

func compareRole(role1 string, role2 string) bool {
	fmt.Println(role1, role2)
	switch role1 {
	case "owner":
		return false
	case "admin":
		if role2 == "owner" || role2 == "admin" {
			return true
		}
	case "editor":
		if role2 == "owner" || role2 == "admin" || role2 == "editor" {
			return true
		}
	case "commentor":
		if role2 == "owner" || role2 == "admin" || role2 == "editor" || role2 == "commentor" {
			return true
		}
	case "viewer":
		if role2 == "owner" || role2 == "admin" || role2 == "editor" || role2 == "commentor" || role2 == "viewer" {
			return true
		}
	default:
		return false
	}
	return false
}

func getHighestRole(roles []string) string {
	if len(roles) == 0 {
		return ""
	}
	highestRole := roles[0]
	for _, role := range roles {
		if compareRole(highestRole, role) {
			highestRole = role
		}
	}
	return highestRole
}

func getSpaceUsers(spaceId uuid.UUID) ([]User, error) {
	tuples, err := core.GetSubjectsAssociatedWithEntity("space", spaceId.String())
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	// user id to role list map
	usersMap := make(map[string][]string)
	users := make([]User, 0)
	for _, tuple := range tuples {
		// users = append(users, User{Id: uuid.MustParse(tuple.Subject.Id), Name: tuple.Subject.Id, Role: tuple.Relation})
		if _, ok := usersMap[tuple.Subject.Id]; ok {
			usersMap[tuple.Subject.Id] = append(usersMap[tuple.Subject.Id], tuple.Relation)
		} else {
			usersMap[tuple.Subject.Id] = []string{tuple.Relation}
		}
	}
	// loop through usersMap
	for userId, roles := range usersMap {
		users = append(users, User{Id: uuid.MustParse(userId), Name: userId, Role: getHighestRole(roles)})
	}
	// get zita ids
	ids := make([]string, 0)
	for _, user := range users {
		ids = append(ids, user.Id.String())
	}
	zIds, err := core.GetZitaIds(ids)
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	// get user details from zitadel
	zitaIds := make([]string, 0)
	ZitaIdsMap := make(map[string]string)
	for _, zId := range zIds {
		zitaIds = append(zitaIds, zId.Id)
		ZitaIdsMap[zId.UserId] = zId.Id
	}
	usersDetails, err := core.SearchUsersByIds(zitaIds)
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	for i, user := range users {
		if zId, ok := ZitaIdsMap[user.Id.String()]; ok {
			for _, result := range usersDetails.Result {
				if result.UserId == zId {
					users[i].Name = result.Human.Profile.DisplayName
					users[i].Email = result.Human.Email.Email
					break
				}
			}
		}
	}
	return users, nil
}

func getSpaceDetails(spaceId uuid.UUID) (Space, error) {
	var space Space
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return space, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, GET_SPACE, spaceId)
	if err != nil {
		logger().Error(err.Error())
		return space, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	space, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[Space])
	if errors.Is(err, pgx.ErrNoRows) {
		return space, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA])
	}
	if err != nil {
		logger().Error(err.Error())
		return space, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	return space, nil
}
