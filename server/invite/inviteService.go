package invite

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"github.com/durgakiran/beskar/quota"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	errInviteNotFound        = errors.New("invite not found")
	errInviteWrongAccount    = errors.New("invite belongs to another account")
	errInviteInvalidDecision = errors.New("invalid invite decision")
)

func normalizeInviteStatus(status sql.NullString) *string {
	if !status.Valid {
		return nil
	}
	value := strings.ToLower(strings.TrimSpace(status.String))
	if value == "" {
		return nil
	}
	return &value
}

func inviteDecisionToStatus(decision string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case "accept":
		return STATUS_ACCEPTED, nil
	case "reject":
		return STATUS_REJECTED, nil
	default:
		return "", errInviteInvalidDecision
	}
}

func lookupSenderName(senderID uuid.UUID) string {
	zIds, err := core.GetZitaIds([]string{senderID.String()})
	if err != nil || len(zIds) == 0 {
		return "Someone"
	}

	userDetails, err := core.SearchUsersByIds([]string{zIds[0].Id})
	if err != nil {
		return "Someone"
	}
	for _, user := range userDetails.Result {
		if user.UserId == zIds[0].Id {
			name := strings.TrimSpace(user.Human.Profile.DisplayName)
			if name != "" {
				return name
			}
			email := strings.TrimSpace(user.Human.Email.Email)
			if email != "" {
				return email
			}
		}
	}
	return "Someone"
}

func inviteDetailsResponse(invite InviteDetailsDBO) InviteDetailsResponse {
	return InviteDetailsResponse{
		Entity:     invite.Entity,
		EntityId:   invite.EntityId,
		SenderId:   invite.SenderId,
		SenderName: lookupSenderName(invite.SenderId),
		Name:       invite.Name,
		Role:       invite.Role,
		Token:      invite.Token,
		Status:     effectiveInviteStatus(invite, time.Now()),
		CreatedAt:  invite.CreatedAt,
		UpdatedAt:  invite.UpdatedAt,
	}
}

const inviteLifetime = 7 * 24 * time.Hour

func effectiveInviteStatus(invite InviteDetailsDBO, now time.Time) *string {
	if status := normalizeInviteStatus(invite.Status); status != nil {
		return status
	}
	if invite.CreatedAt == nil || !now.Before(invite.CreatedAt.Add(inviteLifetime)) {
		status := "expired"
		return &status
	}
	return nil
}

func getInviteDetailsForUser(email string, token string) (InviteDetailsResponse, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return InviteDetailsResponse{}, errInviteNotFound
	}
	if strings.TrimSpace(email) == "" {
		return InviteDetailsResponse{}, errInviteWrongAccount
	}

	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return InviteDetailsResponse{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()

	rows, err := conn.Query(ctx, GET_INVITE_DETAILS_BY_TOKEN_QUERY, token)
	if err != nil {
		logger().Error(err.Error())
		return InviteDetailsResponse{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()

	invite, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[InviteDetailsDBO])
	if errors.Is(err, pgx.ErrNoRows) {
		return InviteDetailsResponse{}, errInviteNotFound
	}
	if err != nil {
		logger().Error(err.Error())
		return InviteDetailsResponse{}, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	if !strings.EqualFold(strings.TrimSpace(invite.Email), strings.TrimSpace(email)) {
		return InviteDetailsResponse{}, errInviteWrongAccount
	}

	return inviteDetailsResponse(invite), nil
}

type inviteAcceptance func(context.Context, InviteDetailsDBO, string) error

func grantInviteAccess(ctx context.Context, invite InviteDetailsDBO, userID string) error {
	if invite.Entity != "space" {
		return errors.New("unsupported invitation entity")
	}
	spaceID, err := uuid.Parse(invite.EntityId)
	if err != nil {
		return err
	}
	if err := core.ValidateSpaceMutable(spaceID); err != nil {
		return err
	}
	permission := core.SPACE_INVITE_MEMBER
	if invite.Role == "admin" {
		permission = core.SPACE_INVITE_ADMIN
	}
	allowed, err := core.CheckPermission("space", invite.EntityId, "user", invite.SenderId.String(), permission)
	if err != nil {
		return err
	}
	if !allowed {
		return errors.New("the sender can no longer invite users to this space")
	}
	role, err := normalizeInviteRelation(invite.Role)
	if err != nil {
		return err
	}
	existing, err := core.CheckPermission("space", invite.EntityId, "user", userID, core.SPACE_VIEW)
	if err != nil {
		return err
	}
	// A replay or a separately added member must not consume another quota slot
	// or silently change an existing member's role.
	if existing {
		return nil
	}
	if err := quota.ValidateCollaboratorAddition(ctx, spaceID, 1, false); err != nil {
		return err
	}
	_, err = core.CreateSubjectPermissionsContext(ctx, "space", invite.EntityId, "user", userID, role)
	if err != nil {
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	return nil
}

// Lock the invitation until the decision commits so concurrent accept/reject and
// revocation cannot race past the pending-status check. Permission writes are
// idempotent; a failed database commit remains retryable without a second seat.
func decideInvite(ctx context.Context, pool *pgxpool.Pool, userID, email, token, decision string, grant inviteAcceptance) (InviteDecisionResponse, *InviteDetailsDBO, error) {
	status, err := inviteDecisionToStatus(decision)
	if err != nil {
		return InviteDecisionResponse{}, nil, err
	}
	if _, err := uuid.Parse(userID); err != nil {
		return InviteDecisionResponse{}, nil, errInviteWrongAccount
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return InviteDecisionResponse{}, nil, errInviteNotFound
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return InviteDecisionResponse{}, nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, GET_INVITE_DETAILS_BY_TOKEN_QUERY+" FOR UPDATE OF i", token)
	if err != nil {
		return InviteDecisionResponse{}, nil, err
	}
	invite, err := pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[InviteDetailsDBO])
	if errors.Is(err, pgx.ErrNoRows) {
		return InviteDecisionResponse{}, nil, errInviteNotFound
	}
	if err != nil {
		return InviteDecisionResponse{}, nil, err
	}
	if strings.TrimSpace(email) == "" || !strings.EqualFold(strings.TrimSpace(invite.Email), strings.TrimSpace(email)) {
		return InviteDecisionResponse{}, nil, errInviteWrongAccount
	}
	result := InviteDecisionResponse{Entity: invite.Entity, EntityId: invite.EntityId}
	if current := effectiveInviteStatus(invite, time.Now()); current != nil {
		result.Status = *current
		return result, nil, nil
	}
	if status == STATUS_ACCEPTED {
		if err := grant(ctx, invite, userID); err != nil {
			return InviteDecisionResponse{}, nil, err
		}
	}
	tag, err := tx.Exec(ctx, UPDATE_INVITE, status, token, strings.TrimSpace(email))
	if err != nil {
		return InviteDecisionResponse{}, nil, err
	}
	if tag.RowsAffected() != 1 {
		return InviteDecisionResponse{}, nil, errors.New("invitation changed; reload and try again")
	}
	if err := tx.Commit(ctx); err != nil {
		return InviteDecisionResponse{}, nil, err
	}
	result.Status = strings.ToLower(status)
	return result, &invite, nil
}

func processInviteDecision(userId, emailId, token, decision string) (InviteDecisionResponse, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	result, changed, err := decideInvite(ctx, core.GetPool(), userId, emailId, token, decision, grantInviteAccess)
	if err == nil && changed != nil {
		emitSpaceInviteDecisionInApp(ctx, inviteDetailsResponse(*changed), userId, emailId, result.Status)
	} else if err == nil {
		resolveSpaceInviteNotification(ctx, token, userId)
	}
	return result, err
}

func (i Invite) removeInvitation() error {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()
	tag, err := conn.Exec(context.Background(), REMOVE_INVITATION, i.SenderId, i.Email, i.EntityId, i.Role)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	rowsAffected := tag.RowsAffected()
	logger().Info(fmt.Sprintf("Updated rows %v", rowsAffected))
	return nil
}

func (i *Invite) invite() (string, error) {
	// Resolve recipient identity server-side; never trust a caller-supplied user ID.
	i.UserId = uuid.Nil
	token := i.token()
	if token == "" {
		logger().Error("unable to create token")
		return token, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	users, err := core.SearchUserByEmail(i.Email, 1, 0)
	if err != nil {
		logger().Error(err.Error())
	}
	for _, user := range users.Result {
		if strings.EqualFold(user.Human.Email.Email, i.Email) {
			id, err := core.GetBeskarUser(user.UserId)
			if err != nil {
				logger().Error(err.Error())
			} else {
				i.UserId = uuid.MustParse(id)
			}
		}
	}
	if i.UserId != uuid.Nil {
		permission, err := core.CheckPermission(i.Entity, i.EntityId, "user", i.UserId.String(), core.SPACE_VIEW)
		if err != nil {
			return token, err
		}
		if permission {
			logger().Error("user is already a member of the space")
			// user is already a member of the space
			return token, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		}
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error("Unable to acquire a connection: " + err.Error())
		return token, err
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		logger().Error(err.Error())
		defer conn.Release()
		return token, err
	}
	defer conn.Release()
	defer tx.Rollback(ctx)
	// Expired pending rows must not prevent a fresh invitation (or reserve seats).
	if _, err := tx.Exec(ctx, `UPDATE notifications.invites SET status = 'EXPIRED', updated_at = now()
        WHERE entity = $1 AND entity_id = $2 AND status IS NULL
        AND (created_at IS NULL OR created_at <= now() - interval '7 days')`, i.Entity, i.EntityId); err != nil {
		return token, err
	}
	var exists int
	if i.UserId != uuid.Nil {
		err = tx.QueryRow(ctx, CHECK_PENDING_INVITE_EXISTS_BY_USER_QUERY, i.Entity, i.EntityId, i.UserId).Scan(&exists)
		if err == nil && exists == 1 {
			return token, errors.New("pending invite already exists")
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			logger().Error(err.Error())
			return token, err
		}
	}
	err = tx.QueryRow(ctx, CHECK_PENDING_INVITE_EXISTS_QUERY, i.Entity, i.EntityId, i.Email).Scan(&exists)
	if err == nil && exists == 1 {
		return token, errors.New("pending invite already exists")
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		logger().Error(err.Error())
		return token, err
	}
	if i.Entity == "space" {
		spaceID, err := uuid.Parse(i.EntityId)
		if err != nil {
			return token, err
		}
		if err := quota.ValidateCollaboratorAddition(ctx, spaceID, 1, true); err != nil {
			return token, err
		}
	}
	// create entry in the database
	tag, err := tx.Exec(ctx, CREATE_INVITE, i.SenderId, token, i.UserId, i.Entity, i.EntityId, i.Email, i.Role)
	if err != nil {
		logger().Error(err.Error())
		return token, err
	}
	affected := tag.RowsAffected()
	err = tx.Commit(ctx)
	if err != nil {
		logger().Error(err.Error())
		return token, err
	}
	logger().Info(fmt.Sprintf("Inserted %v records into invites", affected))
	return token, nil
}

func (i Invite) token() string {
	// 128 random bits, encoded within the existing VARCHAR(35) column.
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(token[:])
}

func getSpaceInvites(spaceId uuid.UUID) ([]InviteDBOV3, error) {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, GET_INVITES_QUERY, spaceId)
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	invites, err := pgx.CollectRows(rows, pgx.RowToStructByNameLax[InviteDBOV3])
	if err != nil {
		logger().Error(err.Error())
		return nil, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	return invites, nil
}

func getUserInvites(userId string, email string) (UserInvites, error) {
	var userInvites UserInvites
	if email == "" {
		logger().Error("Email of the user not found")
		return userInvites, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}

	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return userInvites, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, GET_INVITES_OF_USER_QUERY, email)
	if err != nil {
		logger().Error(err.Error())
		return userInvites, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	invites, err := pgx.CollectRows(rows, pgx.RowToStructByNameLax[InviteDBOV4])
	if err != nil {
		logger().Error(err.Error())
		return userInvites, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	if len(invites) == 0 {
		return UserInvites{Invites: []InviteDBOV5{}}, nil
	}

	// get user details of senders
	senders := make([]string, 0)
	for _, invite := range invites {
		senders = append(senders, invite.SenderId.String())
	}
	zIds, err := core.GetZitaIds(senders)
	if err != nil {
		logger().Error(err.Error())
		return userInvites, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	zitaIds := make([]string, 0)
	zitaIdMap := make(map[string]string)
	for _, zId := range zIds {
		zitaIds = append(zitaIds, zId.Id)
		zitaIdMap[zId.Id] = zId.UserId
	}
	senderNameByUserId := make(map[string]string)
	if len(zitaIds) > 0 {
		userDetails, err := core.SearchUsersByIds(zitaIds)
		if err != nil {
			logger().Error(err.Error())
			return userInvites, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
		}
		for _, user := range userDetails.Result {
			if senderId, ok := zitaIdMap[user.UserId]; ok {
				senderNameByUserId[senderId] = user.Human.Profile.DisplayName
			}
		}
	}

	// populate sender details
	invitesOut := make([]InviteDBOV5, 0)
	for _, invite := range invites {
		inviteOut := InviteDBOV5{
			InviteDBOV4: invite,
		}
		if senderName, ok := senderNameByUserId[invite.SenderId.String()]; ok {
			inviteOut.SenderName = senderName
		}
		invitesOut = append(invitesOut, inviteOut)
	}
	userInvites = UserInvites{
		Invites: invitesOut,
	}

	return userInvites, nil
}
