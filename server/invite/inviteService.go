package invite

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func (invite InviteDBO) _removeInvitation(userId string, token string, conn *pgxpool.Conn) error {
	rows, err := conn.Query(context.Background(), GET_TOKEN_STATUS_BY_SENDER, invite.SenderId, token)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	var inviteBySender InviteDBOV2
	inviteBySender, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[InviteDBOV2])
	if errors.Is(err, pgx.ErrNoRows) {

	}
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	if inviteBySender.UserId != uuid.MustParse(userId) {
		logger().Error("Userd of the token and sender id are not matching.")
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
	}
	tag, err := conn.Exec(context.Background(), UPDATE_INVITE_BY_SENDER, STATUS_REMOVED, token, invite.SenderId)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	rowsAffected := tag.RowsAffected()
	logger().Info(fmt.Sprintf("Updated rows %v", rowsAffected))
	return nil
}

func (invite InviteDBO) _rejectInvitation(userId string, emailId string, role string, token string, conn *pgxpool.Conn) error {
	tag, err := conn.Exec(context.Background(), UPDATE_INVITE, STATUS_REJECTED, token, emailId)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	rowsAffected := tag.RowsAffected()
	logger().Info(fmt.Sprintf("Updated rows %v", rowsAffected))
	return nil
}

func (invite InviteDBO) _acceptInvitation(userId string, emailId string, role string, token string, conn *pgxpool.Conn) error {
	_, err := core.CreateSubjectPermissions(invite.Entity, invite.EntityId, "user", userId, role)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	tag, err := conn.Exec(context.Background(), UPDATE_INVITE, STATUS_ACCEPTED, token, emailId)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	rowsAffected := tag.RowsAffected()
	logger().Info(fmt.Sprintf("Updated rows %v", rowsAffected))
	return nil
}

func processInvitation(userId string, emailId string, token string, decision string) error {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, GET_TOKEN_STATUS, emailId, token)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	var invite InviteDBO
	invite, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByNameLax[InviteDBO])
	if errors.Is(err, pgx.ErrNoRows) {

	}
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_WHILE_READING_ROWS])
	}
	if invite.Status.Valid {
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	} else {
		switch decision {
		case STATUS_ACCEPTED:
			return invite._acceptInvitation(userId, emailId, invite.Role, token, conn)
		case STATUS_REJECTED:
			return invite._rejectInvitation(userId, emailId, invite.Role, token, conn)
		case STATUS_REMOVED:
			return invite._removeInvitation(userId, token, conn)
		}
	}
	return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
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

func (i Invite) invite() (string, error) {
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
		if user.Human.Email.Email == i.Email {
			id, err := core.GetBeskarUser(user.UserId)
			if err != nil {
				logger().Error(err.Error())
			} else {
				i.UserId = uuid.MustParse(id)
			}
		}
	}
	if i.UserId != uuid.Nil {
		permission, _ := core.CheckPermission(i.Entity, i.EntityId, "user", i.UserId.String(), core.PAGE_VIEW)
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
	defer tx.Rollback(ctx)
	defer conn.Release()
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
	str := i.Entity + i.EntityId + i.Email + i.SenderId.String() + i.Role
	h := md5.New()
	_, err := h.Write([]byte(str))
	if err != nil {
		return ""
	}
	hashValue := h.Sum(nil)
	return hex.EncodeToString(hashValue)
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
	userDetails, err := core.SearchUsersByIds(zitaIds)
	if err != nil {
		logger().Error(err.Error())
		return userInvites, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}

	// populate sender details
	invitesOut := make([]InviteDBOV5, 0)
	for _, invite := range invites {
		for _, user := range userDetails.Result {
			if invite.SenderId.String() == zitaIdMap[user.UserId] {
				inviteOut := InviteDBOV5{
					InviteDBOV4: invite,
					SenderName:  user.Human.Profile.DisplayName,
				}
				invitesOut = append(invitesOut, inviteOut)
				break
			}
		}
	}
	userInvites = UserInvites{
		Invites: invitesOut,
	}

	return userInvites, nil
}
