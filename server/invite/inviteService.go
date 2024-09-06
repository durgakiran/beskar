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

func (invite InviteDBO) _rejectInvitation(userId string, token string, conn *pgxpool.Conn) error {
	tag, err := conn.Exec(context.Background(), UPDATE_INVITE, STATUS_REJECTED, token, userId)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	rowsAffected := tag.RowsAffected()
	logger().Info(fmt.Sprintf("Updated rows %v", rowsAffected))
	return nil
}

func (invite InviteDBO) _acceptInvitation(userId string, token string, conn *pgxpool.Conn) error {
	_, err := core.CreateSubjectPermissions(invite.Entity, invite.EntityId, "user", userId, "viewer")
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	tag, err := conn.Exec(context.Background(), UPDATE_INVITE, STATUS_ACCEPTED, token, userId)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	rowsAffected := tag.RowsAffected()
	logger().Info(fmt.Sprintf("Updated rows %v", rowsAffected))
	return nil
}

func processInvitation(userId string, token string, decision string) error {
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	defer conn.Conn().Close(ctx)
	if err != nil {
		logger().Error(err.Error())
		return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	rows, err := conn.Query(ctx, GET_TOKEN_STATUS, userId, token)
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
		// switch invite.Status.String {
		// case STATUS_ACCEPTED:
		// 	return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		// case STATUS_REJECTED:
		// 	return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		// case STATUS_REMOVED:
		// 	return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		// }
		switch decision {
		case STATUS_ACCEPTED:
			return invite._acceptInvitation(userId, token, conn)
		case STATUS_REJECTED:
			return invite._rejectInvitation(userId, token, conn)
		case STATUS_REMOVED:
			return invite._removeInvitation(userId, token, conn)
		}
	}
	return errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
}

func (i Invite) invite() (string, error) {
	token := i.token()
	if token == "" {
		logger().Error("unable to create token")
		return token, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNSPECIFIED])
	}
	exists, err := core.CheckPermission(i.Entity, i.EntityId, "user", i.UserId.String(), "view")
	if err != nil {
		return token, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	if exists {
		return token, errors.New(core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
	}
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	if err != nil {
		logger().Error(err.Error())
		return token, err
	}

	defer tx.Rollback(ctx)
	// create entry in the database
	tag, err := tx.Exec(ctx, CREATE_INVITE, i.SenderId, token, i.UserId, i.Entity, i.EntityId)
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
	str := i.Entity + i.EntityId + i.UserId.String() + i.SenderId.String()
	h := md5.New()
	_, err := h.Write([]byte(str))
	if err != nil {
		return ""
	}
	hashValue := h.Sum(nil)
	return hex.EncodeToString(hashValue)
}
