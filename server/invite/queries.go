package invite

const (
	CREATE_INVITE              = "INSERT INTO notifications.invites( sender_id, token, user_id, entity, entity_id, email_id, role ) VALUES ( $1, $2, $3, $4, $5, $6, $7 )"
	GET_TOKEN_STATUS           = "SELECT status, sender_id, entity, entity_id, role  FROM notifications.invites WHERE email_id = $1 AND token = $2"
	GET_TOKEN_STATUS_BY_SENDER = "SELECT status, entity, user_id, entity_id  FROM notifications.invites WHERE sender_id = $1 AND token = $2"
	UPDATE_INVITE              = "UPDATE notifications.invites SET status = $1 WHERE token = $2 and email_id = $3"
	UPDATE_INVITE_BY_SENDER    = "UPDATE notifications.invites SET status = $1 WHERE token = $2 and sender_id = $3"
	GET_INVITES_QUERY          = "SELECT sender_id, entity, entity_id, email_id, role, status FROM notifications.invites WHERE entity_id = $1 AND status IS NULL"
	REMOVE_INVITATION          = "DELETE FROM notifications.invites WHERE sender_id = $1 AND email_id = $2 AND entity_id = $3 AND role = $4"
	GET_INVITES_OF_USER_QUERY  = `SELECT 
										i.sender_id AS sender_id, 
										i.entity AS entity, 
										i.entity_id AS entity_id, 
										i.email_id AS email_id, 
										i.role AS role, 
										i.status AS status,
										i.token AS token,
										s.name AS name
									FROM 
										notifications.invites i LEFT JOIN core.space s ON (i.entity = 'space' AND i.entity_id = s.id::varchar)
									WHERE 
										i.email_id = $1 AND i.status IS NULL`
)
