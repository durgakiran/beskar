package space

import (
	"context"
	"errors"
	"time"

	permify_payload "buf.build/gen/go/permifyco/permify/protocolbuffers/go/base/v1"
	"github.com/durgakiran/beskar/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Space) Create(conn pgx.Tx, ctx context.Context) (uuid.UUID, error) {
	var spaceId uuid.UUID
	err := conn.QueryRow(ctx, INSERT_SPACE, s.Name, s.DateCreated, s.DateUpdated, s.CreatedBy).Scan(&spaceId)
	if err != nil {
		logger().Error(err.Error())
		return uuid.Nil, errors.New(ErrorCode_name[ErrorCode_ERROR_WHILE_INSERTING_ROWS])
	}
	return spaceId, nil
}

func (s Space) Update() {}

func (s Space) Delete() {}

func createSpaceEntry(s Space) (uuid.UUID, error) {
	var spaceId uuid.UUID
	connPool := core.GetPool()
	ctx := context.Background()
	tx, err := connPool.Begin(ctx)
	defer tx.Rollback(ctx)
	if err != nil {
		// error while acquiring database connection
		logger().Error(err.Error())
		return spaceId, errors.New(ErrorCode_name[ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}
	s.DateCreated = time.Now()
	s.DateUpdated = time.Now()
	spaceId, err = s.Create(tx, ctx)
	// create entry in permission system
	permifyClient := core.GetPermifyInstance()
	_, err = permifyClient.Data.WriteRelationships(
		ctx,
		&permify_payload.RelationshipWriteRequest{
			TenantId: "t1",
			Metadata: &permify_payload.RelationshipWriteRequestMetadata{
				SchemaVersion: "",
			},
			Tuples: []*permify_payload.Tuple{
				{
					Entity: &permify_payload.Entity{
						Type: "space",
						Id:   spaceId.String(),
					},
					Relation: "owner",
					Subject: &permify_payload.Subject{
						Type: "user",
						Id:   s.CreatedBy.String(),
					},
				},
			},
		},
	)
	if err != nil {
		logger().Error(err.Error())
		return spaceId, errors.New(ErrorCode_name[ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}
	tx.Commit(ctx)
	return spaceId, nil
}

func ListSpaces(userId uuid.UUID) ([]Space, error) {
	var spaces []Space
	spaceIds := make([]string, 0)
	client := core.GetPermifyInstance()
	str, err := client.Permission.LookupEntity(
		context.Background(),
		&permify_payload.PermissionLookupEntityRequest{
			TenantId: "t1",
			Metadata: &permify_payload.PermissionLookupEntityRequestMetadata{
				SchemaVersion: "",
				Depth:         20,
				SnapToken:     "",
			},
			EntityType: "space",
			Permission: "view",
			Subject: &permify_payload.Subject{
				Type: "user",
				Id:   userId.String(),
			},
		},
	)
	if err != nil {
		// return error
		logger().Error(err.Error())
		return spaces, errors.New(ErrorCode_name[ErrorCode_ERROR_CODE_PERMISSION_SERVER_ISSUE])
	}

	spaceIds = append(spaceIds, str.GetEntityIds()...)
	if len(spaceIds) == 0 {
		return spaces, errors.New(ErrorCode_name[ErrorCode_ERROR_CODE_NO_DATA])
	}
	connPool := core.GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		// error while acquiring database connection
		logger().Error(err.Error())
		return spaces, errors.New(ErrorCode_name[ErrorCode_ERROR_CODE_CONNECTION_ISSUE])
	}

	rows, err := conn.Query(ctx, GET_SPACES, spaceIds)
	if err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(ErrorCode_name[ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	defer rows.Close()
	for rows.Next() {
		var r Space
		err := rows.Scan(&r.Id, &r.Name, &r.DateCreated, &r.DateUpdated, &r.CreatedBy)
		if err != nil {
			logger().Error(err.Error())
			return spaces, errors.New(ErrorCode_name[ErrorCode_ERROR_WHILE_READING_ROWS])
		}
		spaces = append(spaces, r)
	}
	if err = rows.Err(); err != nil {
		logger().Error(err.Error())
		return spaces, errors.New(ErrorCode_name[ErrorCode_ERROR_WHILE_FETCHING_ROWS])
	}
	return spaces, nil
}
