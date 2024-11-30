package invite

const (
	CREATE_INVITE              = "INSERT INTO notifications.invites( sender_id, token, user_id, entity, entity_id, email_id, role ) VALUES ( $1, $2, $3, $4, $5, $6, $7 )"
	GET_TOKEN_STATUS           = "SELECT status, sender_id, entity, entity_id  FROM notifications.invites WHERE user_id = $1 AND token = $2"
	GET_TOKEN_STATUS_BY_SENDER = "SELECT status, entity, user_id, entity_id  FROM notifications.invites WHERE sender_id = $1 AND token = $2"
	UPDATE_INVITE              = "UPDATE notifications.invites SET status = $1 WHERE token = $2 and user_id = $3"
	UPDATE_INVITE_BY_SENDER    = "UPDATE notifications.invites SET status = $1 WHERE token = $2 and sender_id = $3"
)
