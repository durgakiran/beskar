package space

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type pageCountRow struct {
	SpaceId         uuid.UUID `db:"space_id"`
	DocCount        int       `db:"doc_count"`
	WhiteboardCount int       `db:"whiteboard_count"`
}

type spaceStateRow struct {
	ArchivedAt *time.Time `db:"archived_at"`
	DeletedAt  *time.Time `db:"deleted_at"`
}

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

func normalizeRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "commentor":
		return "commenter"
	default:
		return strings.ToLower(strings.TrimSpace(role))
	}
}

func storageRole(role string) string {
	if normalizeRole(role) == "commenter" {
		return "commentor"
	}
	return normalizeRole(role)
}

func roleWeight(role string) int {
	switch storageRole(role) {
	case "owner":
		return 4
	case "admin":
		return 3
	case "editor":
		return 2
	case "commentor":
		return 1
	case "viewer":
		return 0
	default:
		return -1
	}
}

func getHighestRole(roles []string) string {
	highest := ""
	highestWeight := -1
	for _, role := range roles {
		if weight := roleWeight(role); weight > highestWeight {
			highest = role
			highestWeight = weight
		}
	}
	return normalizeRole(highest)
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
		userRole = getHighestRole(roles)
	}

	return len(usersMap), userRole, nil
}

func ListSpaces(userId uuid.UUID) ([]SpaceListItem, error) {
	var spaces []SpaceListItem
	spaceIds, err := core.GetEntitiesWithPermission("space", "user", userId.String(), "view")
	if err != nil {
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

	spaceIndexByID := make(map[uuid.UUID]int)
	for rows.Next() {
		var item SpaceListItem
		if err := rows.Scan(&item.Id, &item.Name, &item.Description, &item.DateUpdated, &item.CreatedBy, &item.ArchivedAt); err != nil {
			logger().Error(err.Error())
			return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
		}
		item.UserRole = "viewer"
		spaces = append(spaces, item)
		spaceIndexByID[item.Id] = len(spaces) - 1
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
	return hydrateSpaceList(spaces, spaceIndexByID, countRows, userId)
}

type countRowsType = pageCountRow

func hydrateSpaceList(spaces []SpaceListItem, spaceIndexByID map[uuid.UUID]int, countRows pgx.Rows, userId uuid.UUID) ([]SpaceListItem, error) {
	pageCounts, err := pgx.CollectRows[countRowsType](countRows, pgx.RowToStructByNameLax[countRowsType])
	if err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	for _, row := range pageCounts {
		if index, ok := spaceIndexByID[row.SpaceId]; ok {
			spaces[index].DocCount = row.DocCount
			spaces[index].WhiteboardCount = row.WhiteboardCount
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
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	pageList, err = pgx.CollectRows[PageList](rows, pgx.RowToStructByNameLax[PageList])
	if err != nil {
		logger().Error(err.Error())
		return pageList, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	return pageList, nil
}

func getPageDescendants(spaceId uuid.UUID, userId uuid.UUID, pageId int64) ([]PageDescendant, error) {
	pages, err := getDocumentList(spaceId, userId)
	if err != nil {
		return nil, err
	}

	pageExists := false
	childrenByParent := make(map[int64][]PageList)
	for _, page := range pages {
		if page.PageId == pageId {
			pageExists = true
		}
		if page.Type == "whiteboard" {
			continue
		}
		childrenByParent[page.ParentId] = append(childrenByParent[page.ParentId], page)
	}

	if !pageExists {
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA])
	}

	visited := make(map[int64]bool)
	var buildTree func(parentId int64) []PageDescendant
	buildTree = func(parentId int64) []PageDescendant {
		children := childrenByParent[parentId]
		result := make([]PageDescendant, 0, len(children))
		for _, child := range children {
			if visited[child.PageId] {
				continue
			}
			visited[child.PageId] = true
			title := strings.TrimSpace(child.Title)
			if title == "" {
				title = "Untitled"
			}
			result = append(result, PageDescendant{
				PageId:   child.PageId,
				Title:    title,
				Type:     child.Type,
				Children: buildTree(child.PageId),
			})
		}
		return result
	}

	visited[pageId] = true
	return buildTree(pageId), nil
}

func getSpaceUsers(spaceId uuid.UUID) ([]User, error) {
	tuples, err := core.GetSubjectsAssociatedWithEntity("space", spaceId.String())
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}

	usersMap := make(map[string][]string)
	for _, tuple := range tuples {
		usersMap[tuple.Subject.Id] = append(usersMap[tuple.Subject.Id], tuple.Relation)
	}

	users := make([]User, 0, len(usersMap))
	for userID, roles := range usersMap {
		parsed, err := uuid.Parse(userID)
		if err != nil {
			continue
		}
		highestRole := getHighestRole(roles)
		users = append(users, User{
			Id:      parsed,
			Name:    userID,
			Role:    highestRole,
			IsOwner: storageRole(highestRole) == "owner",
		})
	}

	if len(users) == 0 {
		return users, nil
	}

	ids := make([]string, 0, len(users))
	for _, user := range users {
		ids = append(ids, user.Id.String())
	}
	zitaMapRows, err := core.GetZitaIds(ids)
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	zitaIDByBeskarID := make(map[string]string, len(zitaMapRows))
	zitaIDs := make([]string, 0, len(zitaMapRows))
	for _, row := range zitaMapRows {
		zitaIDByBeskarID[row.UserId] = row.Id
		zitaIDs = append(zitaIDs, row.Id)
	}
	if len(zitaIDs) == 0 {
		return users, nil
	}
	usersDetails, err := core.SearchUsersByIds(zitaIDs)
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	userByZitaID := make(map[string]core.User, len(usersDetails.Result))
	for _, result := range usersDetails.Result {
		userByZitaID[result.UserId] = result
	}
	for i := range users {
		if zitaID, ok := zitaIDByBeskarID[users[i].Id.String()]; ok {
			if result, found := userByZitaID[zitaID]; found {
				users[i].Name = result.Human.Profile.DisplayName
				users[i].Email = result.Human.Email.Email
			}
		}
		if users[i].Name == "" {
			users[i].Name = users[i].Email
		}
	}
	return users, nil
}

func getCurrentOwner(spaceId uuid.UUID) (User, error) {
	users, err := getSpaceUsers(spaceId)
	if err != nil {
		return User{}, err
	}
	for _, user := range users {
		if user.IsOwner {
			return user, nil
		}
	}
	return User{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA])
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

	countRows, err := conn.Query(ctx, GET_SPACE_PAGE_COUNTS, []uuid.UUID{spaceId})
	if err == nil {
		defer countRows.Close()
		pageCounts, collectErr := pgx.CollectRows[countRowsType](countRows, pgx.RowToStructByNameLax[countRowsType])
		if collectErr == nil && len(pageCounts) > 0 {
			space.DocCount = pageCounts[0].DocCount
			space.WhiteboardCount = pageCounts[0].WhiteboardCount
		}
	}

	memberCount, userRole, membershipErr := getSpaceMembershipSummary(spaceId, userId)
	if membershipErr == nil {
		space.MemberCount = memberCount
		space.UserRole = userRole
	}

	owner, ownerErr := getCurrentOwner(spaceId)
	if ownerErr == nil {
		space.CurrentOwnerId = owner.Id
	}

	return space, nil
}

func getSpaceSettingsState(spaceId uuid.UUID, userId uuid.UUID) (SpaceSettingsState, error) {
	space, err := getSpaceDetails(spaceId, userId)
	if err != nil {
		return SpaceSettingsState{}, err
	}
	owner, err := getCurrentOwner(spaceId)
	if err != nil {
		return SpaceSettingsState{}, err
	}
	return SpaceSettingsState{
		Id:                   space.Id,
		Name:                 space.Name,
		Description:          space.Description,
		CreatedBy:            space.CreatedBy,
		CurrentOwnerId:       owner.Id,
		CurrentOwnerName:     owner.Name,
		CurrentOwnerEmail:    owner.Email,
		ArchivedAt:           space.ArchivedAt,
		ArchivedBy:           space.ArchivedBy,
		DeletedAt:            space.DeletedAt,
		MemberCount:          space.MemberCount,
		DocCount:             space.DocCount,
		WhiteboardCount:      space.WhiteboardCount,
		UserRole:             space.UserRole,
		CanManageMembers:     core.ValidateUserSpacePermissions(spaceId, userId, core.SPACE_MANAGE_MEMBERS),
		CanTransferOwnership: core.ValidateUserSpacePermissions(spaceId, userId, core.SPACE_TRANSFER_OWNER),
		CanArchive:           core.ValidateUserSpacePermissions(spaceId, userId, core.SPACE_ARCHIVE),
		CanDelete:            core.ValidateUserSpacePermissions(spaceId, userId, core.SPACE_DELETE),
	}, nil
}

func getSpaceState(spaceId uuid.UUID) (spaceStateRow, error) {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return spaceStateRow{}, err
	}
	defer conn.Release()
	row := conn.QueryRow(ctx, GET_SPACE_STATE, spaceId)
	var state spaceStateRow
	if err := row.Scan(&state.ArchivedAt, &state.DeletedAt); err != nil {
		return state, err
	}
	return state, nil
}

func isSpaceArchived(spaceId uuid.UUID) (bool, error) {
	state, err := getSpaceState(spaceId)
	if err != nil {
		return false, err
	}
	return state.ArchivedAt != nil, nil
}

func isSpaceDeleted(spaceId uuid.UUID) (bool, error) {
	state, err := getSpaceState(spaceId)
	if err != nil {
		return false, err
	}
	return state.DeletedAt != nil, nil
}

func ensureSpaceMutable(spaceId uuid.UUID) error {
	state, err := getSpaceState(spaceId)
	if err != nil {
		return err
	}
	if state.DeletedAt != nil {
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA])
	}
	if state.ArchivedAt != nil {
		return errors.New("space is archived")
	}
	return nil
}

func addSpaceMembers(spaceId uuid.UUID, actorId uuid.UUID, req AddSpaceMembersRequest) (map[string]any, error) {
	if err := ensureSpaceMutable(spaceId); err != nil {
		return nil, err
	}
	if !core.ValidateUserSpacePermissions(spaceId, actorId, core.SPACE_MANAGE_MEMBERS) {
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	existingUsers, err := getSpaceUsers(spaceId)
	if err != nil {
		return nil, err
	}
	existing := make(map[string]bool, len(existingUsers))
	for _, user := range existingUsers {
		existing[user.Id.String()] = true
	}
	addedCount := 0
	skippedExisting := 0
	for _, member := range req.Members {
		if existing[member.UserId] {
			skippedExisting++
			continue
		}
		if err := core.WriteRelations(spaceId.String(), "space", member.UserId, "user", storageRole(member.Role)); err != nil {
			return nil, err
		}
		addedCount++
	}
	return map[string]any{
		"addedCount":      addedCount,
		"skippedExisting": skippedExisting,
	}, nil
}

func changeSpaceMemberRole(spaceId uuid.UUID, actorId uuid.UUID, req ChangeSpaceMemberRoleRequest) (User, error) {
	if err := ensureSpaceMutable(spaceId); err != nil {
		return User{}, err
	}
	if !core.ValidateUserSpacePermissions(spaceId, actorId, core.SPACE_MANAGE_MEMBERS) {
		return User{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	targetID := uuid.MustParse(req.UserId)
	users, err := getSpaceUsers(spaceId)
	if err != nil {
		return User{}, err
	}
	for _, user := range users {
		if user.Id == targetID {
			if user.IsOwner {
				return User{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
			}
			if err := core.DeleteSubjectRelations(spaceId.String(), "space", req.UserId, "user"); err != nil {
				return User{}, err
			}
			if err := core.WriteRelations(spaceId.String(), "space", req.UserId, "user", storageRole(req.Role)); err != nil {
				return User{}, err
			}
			user.Role = normalizeRole(req.Role)
			return user, nil
		}
	}
	return User{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA])
}

func removeSpaceMember(spaceId uuid.UUID, actorId uuid.UUID, req RemoveSpaceMemberRequest) error {
	if err := ensureSpaceMutable(spaceId); err != nil {
		return err
	}
	if !core.ValidateUserSpacePermissions(spaceId, actorId, core.SPACE_MANAGE_MEMBERS) {
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	if actorId.String() == req.UserId {
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	users, err := getSpaceUsers(spaceId)
	if err != nil {
		return err
	}
	for _, user := range users {
		if user.Id.String() == req.UserId {
			if user.IsOwner {
				return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
			}
			return core.DeleteSubjectRelations(spaceId.String(), "space", req.UserId, "user")
		}
	}
	return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_NO_DATA])
}

func searchMemberCandidates(spaceId uuid.UUID, actorId uuid.UUID, req MemberCandidateSearchRequest) (MemberCandidateSearchResponse, error) {
	if !core.ValidateUserSpacePermissions(spaceId, actorId, core.SPACE_MANAGE_MEMBERS) {
		return MemberCandidateSearchResponse{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	users, err := getSpaceUsers(spaceId)
	if err != nil {
		return MemberCandidateSearchResponse{}, err
	}
	memberByEmail := make(map[string]User, len(users))
	for _, user := range users {
		memberByEmail[strings.ToLower(user.Email)] = user
	}

	pendingInvites, err := getPendingInviteEmails(spaceId)
	if err != nil {
		return MemberCandidateSearchResponse{}, err
	}
	inviteByEmail := make(map[string]string, len(pendingInvites))
	for email, role := range pendingInvites {
		inviteByEmail[email] = role
	}

	resp := MemberCandidateSearchResponse{
		Matches:         []MemberCandidate{},
		ExistingMembers: []MemberCandidate{},
		PendingInvites:  []MemberCandidate{},
		UnknownEmails:   []MemberCandidate{},
	}

	seen := map[string]bool{}
	if req.Query != "" {
		searchResult, searchErr := core.SearchUsers(req.Query, req.Limit, req.Offset)
		if searchErr == nil {
			for _, result := range searchResult.Result {
				email := strings.TrimSpace(strings.ToLower(result.Human.Email.Email))
				if email == "" || seen[email] {
					continue
				}
				seen[email] = true

				displayName := strings.TrimSpace(result.Human.Profile.DisplayName)
				if displayName == "" {
					displayName = strings.TrimSpace(strings.Join([]string{result.Human.Profile.GivenName, result.Human.Profile.FamilyName}, " "))
				}
				if displayName == "" {
					displayName = email
				}

				if member, ok := memberByEmail[email]; ok {
					resp.ExistingMembers = append(resp.ExistingMembers, MemberCandidate{
						UserId:        member.Id.String(),
						Name:          member.Name,
						Email:         member.Email,
						AlreadyMember: true,
						CurrentRole:   member.Role,
					})
					continue
				}
				if role, ok := inviteByEmail[email]; ok {
					resp.PendingInvites = append(resp.PendingInvites, MemberCandidate{
						Name:           displayName,
						Email:          email,
						AlreadyInvited: true,
						CurrentRole:    normalizeRole(role),
					})
					continue
				}

				beskarID, idErr := core.GetBeskarUser(result.UserId)
				if idErr != nil {
					continue
				}
				resp.Matches = append(resp.Matches, MemberCandidate{
					UserId: beskarID,
					Name:   displayName,
					Email:  email,
				})
			}
		}
	}

	inputEmails := append([]string{}, req.Emails...)

	for _, email := range inputEmails {
		email = strings.TrimSpace(strings.ToLower(email))
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		if member, ok := memberByEmail[email]; ok {
			resp.ExistingMembers = append(resp.ExistingMembers, MemberCandidate{
				UserId:        member.Id.String(),
				Name:          member.Name,
				Email:         member.Email,
				AlreadyMember: true,
				CurrentRole:   member.Role,
			})
			continue
		}
		if role, ok := inviteByEmail[email]; ok {
			resp.PendingInvites = append(resp.PendingInvites, MemberCandidate{
				Name:           email,
				Email:          email,
				AlreadyInvited: true,
				CurrentRole:    normalizeRole(role),
			})
			continue
		}
		searchResult, searchErr := core.SearchUserByEmail(email, req.Limit, req.Offset)
		if searchErr == nil && len(searchResult.Result) > 0 {
			for _, result := range searchResult.Result {
				beskarID, idErr := core.GetBeskarUser(result.UserId)
				if idErr != nil {
					continue
				}
				displayName := strings.TrimSpace(result.Human.Profile.DisplayName)
				if displayName == "" {
					displayName = strings.TrimSpace(strings.Join([]string{result.Human.Profile.GivenName, result.Human.Profile.FamilyName}, " "))
				}
				if displayName == "" {
					displayName = result.Human.Email.Email
				}
				resp.Matches = append(resp.Matches, MemberCandidate{
					UserId: beskarID,
					Name:   displayName,
					Email:  result.Human.Email.Email,
				})
			}
			if len(searchResult.Result) > 0 {
				continue
			}
		}
		resp.UnknownEmails = append(resp.UnknownEmails, MemberCandidate{
			Name:  email,
			Email: email,
		})
	}

	return resp, nil
}

func transferOwnership(spaceId uuid.UUID, actorId uuid.UUID, req TransferOwnershipRequest) (User, error) {
	if err := ensureSpaceMutable(spaceId); err != nil {
		return User{}, err
	}
	if !core.ValidateUserSpacePermissions(spaceId, actorId, core.SPACE_TRANSFER_OWNER) {
		return User{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	owner, err := getCurrentOwner(spaceId)
	if err != nil {
		return User{}, err
	}
	if owner.Id != actorId {
		return User{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	users, err := getSpaceUsers(spaceId)
	if err != nil {
		return User{}, err
	}
	var nextOwner User
	found := false
	for _, user := range users {
		if user.Id.String() == req.NewOwnerUserId {
			nextOwner = user
			found = true
			break
		}
	}
	if !found || nextOwner.IsOwner {
		return User{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	if err := core.DeleteRelation(spaceId.String(), "space", actorId.String(), "user", "owner"); err != nil {
		return User{}, err
	}
	if err := core.DeleteSubjectRelations(spaceId.String(), "space", req.NewOwnerUserId, "user"); err != nil {
		return User{}, err
	}
	if err := core.WriteRelations(spaceId.String(), "space", actorId.String(), "user", "admin"); err != nil {
		return User{}, err
	}
	if err := core.WriteRelations(spaceId.String(), "space", req.NewOwnerUserId, "user", "owner"); err != nil {
		return User{}, err
	}
	nextOwner.Role = "owner"
	nextOwner.IsOwner = true
	return nextOwner, nil
}

func archiveSpace(spaceId uuid.UUID, actorId uuid.UUID) (Space, error) {
	if !core.ValidateUserSpacePermissions(spaceId, actorId, core.SPACE_ARCHIVE) {
		return Space{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return Space{}, err
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, ARCHIVE_SPACE, spaceId, actorId)
	if err != nil {
		return Space{}, err
	}
	space, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[Space])
	if err != nil {
		return Space{}, err
	}
	return space, nil
}

func unarchiveSpace(spaceId uuid.UUID, actorId uuid.UUID) (Space, error) {
	if !core.ValidateUserSpacePermissions(spaceId, actorId, core.SPACE_ARCHIVE) {
		return Space{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return Space{}, err
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, UNARCHIVE_SPACE, spaceId)
	if err != nil {
		return Space{}, err
	}
	return pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[Space])
}

func softDeleteSpace(spaceId uuid.UUID, actorId uuid.UUID, req DeleteSpaceRequest) error {
	if !core.ValidateUserSpacePermissions(spaceId, actorId, core.SPACE_DELETE) {
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	details, err := getSpaceDetails(spaceId, actorId)
	if err != nil {
		return err
	}
	if !strings.EqualFold(strings.TrimSpace(details.Name), strings.TrimSpace(req.ConfirmName)) {
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	_, err = conn.Exec(ctx, SOFT_DELETE_SPACE, spaceId, actorId)
	return err
}

func getPendingInviteEmails(spaceId uuid.UUID) (map[string]string, error) {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, "SELECT email_id, role FROM notifications.invites WHERE entity = 'space' AND entity_id = $1 AND status IS NULL", spaceId.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]string{}
	for rows.Next() {
		var email string
		var role string
		if err := rows.Scan(&email, &role); err != nil {
			return nil, err
		}
		result[strings.ToLower(email)] = role
	}
	return result, rows.Err()
}

func ensureSpaceMutableByID(spaceId uuid.UUID) error {
	return ensureSpaceMutable(spaceId)
}

func errorf(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}
