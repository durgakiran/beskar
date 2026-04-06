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
	err := conn.QueryRow(ctx, INSERT_SPACE, s.Name, s.Description, s.DateCreated, s.DateUpdated, s.CreatedBy).Scan(&spaceId)
	if err != nil {
		logger().Error(err.Error())
		return uuid.Nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_INSERTING_ROWS])
	}
	return spaceId, nil
}

func (s Space) Update() error {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()

	_, err = conn.Exec(ctx, UPDATE_SPACE, s.Name, s.Description, time.Now(), s.Id)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_UPDATING_ROWS])
	}
	return nil
}

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
	if err != nil {
		return uuid.Nil, err
	}
	// create entry in permission system
	err = core.WriteRelations(spaceId.String(), "space", s.CreatedBy.String(), "user", "owner")
	if err != nil {
		logger().Error(err.Error())
		return spaceId, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	if err = tx.Commit(ctx); err != nil {
		logger().Error(err.Error())
		return uuid.Nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	return spaceId, nil
}

type pageCountRow struct {
	SpaceId         uuid.UUID `db:"space_id"`
	DocCount        int       `db:"doc_count"`
	WhiteboardCount int       `db:"whiteboard_count"`
}

func normalizeRole(role string) string {
	switch role {
	case "commentor":
		return "commenter"
	default:
		return role
	}
}

func getSpaceMembershipSummary(spaceId uuid.UUID, userId uuid.UUID) (int, string, error) {
	tuples, err := core.GetSubjectsAssociatedWithEntity("space", spaceId.String())
	if err != nil {
		logger().Error(err.Error())
		return 0, "", errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}

	usersMap := make(map[string][]string)
	for _, tuple := range tuples {
		usersMap[tuple.Subject.Id] = append(usersMap[tuple.Subject.Id], tuple.Relation)
	}

	userRole := "viewer"
	if roles, ok := usersMap[userId.String()]; ok && len(roles) > 0 {
		userRole = normalizeRole(getHighestRole(roles))
	}

	return len(usersMap), userRole, nil
}

func ListSpaces(userId uuid.UUID) ([]SpaceListItem, error) {
	var spaces []SpaceListItem
	spaceIds := make([]string, 0)
	spaceIds, err := core.GetEntitiesWithPermission("space", "user", userId.String(), "view")
	if err != nil {
		// return error
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	if len(spaceIds) == 0 {
		return spaces, nil
	}

	parsedSpaceIds := make([]uuid.UUID, 0, len(spaceIds))
	for _, spaceId := range spaceIds {
		parsedId, parseErr := uuid.Parse(spaceId)
		if parseErr != nil {
			logger().Error(parseErr.Error())
			return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
		}
		parsedSpaceIds = append(parsedSpaceIds, parsedId)
	}

	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error("Unable to acquire a connection: " + err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()

	rows, err := conn.Query(ctx, GET_SPACES, parsedSpaceIds)
	if err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()

	spaceById := make(map[uuid.UUID]*SpaceListItem, len(parsedSpaceIds))
	for rows.Next() {
		var r SpaceListItem
		err := rows.Scan(&r.Id, &r.Name, &r.Description, &r.DateUpdated, &r.CreatedBy)
		if err != nil {
			logger().Error(err.Error())
			return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
		}
		r.UserRole = "viewer"
		spaces = append(spaces, r)
		spaceById[r.Id] = &spaces[len(spaces)-1]
	}
	if err = rows.Err(); err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}

	countRows, err := conn.Query(ctx, GET_SPACE_PAGE_COUNTS, parsedSpaceIds)
	if err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer countRows.Close()

	pageCounts, err := pgx.CollectRows[pageCountRow](countRows, pgx.RowToStructByNameLax[pageCountRow])
	if err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}

	for _, countRow := range pageCounts {
		if item, ok := spaceById[countRow.SpaceId]; ok {
			item.DocCount = countRow.DocCount
			item.WhiteboardCount = countRow.WhiteboardCount
		}
	}

	for i := range spaces {
		memberCount, userRole, membershipErr := getSpaceMembershipSummary(spaces[i].Id, userId)
		if membershipErr != nil {
			return spaces, membershipErr
		}
		spaces[i].MemberCount = memberCount
		spaces[i].UserRole = userRole
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
		users = append(users, User{Id: uuid.MustParse(userId), Name: userId, Role: normalizeRole(getHighestRole(roles))})
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

func getSpaceDetails(spaceId uuid.UUID, userId uuid.UUID) (Space, error) {
	var space Space
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return space, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()
	
	// 1. Fetch Basic Space Data
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

	// 2. Fetch Page Counts
	countRows, err := conn.Query(ctx, GET_SPACE_PAGE_COUNTS, []uuid.UUID{spaceId})
	if err != nil {
		logger().Error(err.Error())
	} else {
		defer countRows.Close()
		pageCounts, err := pgx.CollectRows[pageCountRow](countRows, pgx.RowToStructByNameLax[pageCountRow])
		if err == nil && len(pageCounts) > 0 {
			space.DocCount = pageCounts[0].DocCount
			space.WhiteboardCount = pageCounts[0].WhiteboardCount
		}
	}

	// 3. Fetch Membership Summary
	memberCount, userRole, membershipErr := getSpaceMembershipSummary(spaceId, userId)
	if membershipErr == nil {
		space.MemberCount = memberCount
		space.UserRole = userRole
	}

	return space, nil
}
