package core

import (
	"context"
	"fmt"
	"os"
	"sync"

	permify_payload "buf.build/gen/go/permifyco/permify/protocolbuffers/go/base/v1"
	permify_grpc "github.com/Permify/permify-go/grpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var lock = &sync.Mutex{}

var singleInstance *permify_grpc.Client

// nonSecureTokenCredentials represents a map used for storing non-secure tokens.
// These tokens do not require transport security.
type nonSecureTokenCredentials map[string]string

// RequireTransportSecurity indicates that transport security is not required for these credentials.
func (c nonSecureTokenCredentials) RequireTransportSecurity() bool {
	return false // Transport security is not required for non-secure tokens.
}

// GetRequestMetadata retrieves the current metadata (non-secure tokens) for a request.
func (c nonSecureTokenCredentials) GetRequestMetadata(_ context.Context, _ ...string) (map[string]string, error) {
	return c, nil // Returns the non-secure tokens as metadata with no error.
}

func GetPermifyInstance() *permify_grpc.Client {
	if singleInstance == nil {
		lock.Lock()
		defer lock.Unlock()
		if singleInstance == nil {
			fmt.Println("creating single instance now")
			client, err := permify_grpc.NewClient(
				permify_grpc.Config{
					Endpoint: os.Getenv("PERMIFY_ENDPOINT"),
				},
				grpc.WithTransportCredentials(insecure.NewCredentials()),
				grpc.WithPerRPCCredentials(nonSecureTokenCredentials{"authorization": fmt.Sprintf("Bearer %s", os.Getenv("PERMIFY_SECRET"))}),
			)
			if err != nil {
				panic("unable to create permify client")
			}
			singleInstance = client
		} else {
			fmt.Println("Single instance already created.")
		}
	} else {
		fmt.Println("Single instance already created.")
	}
	return singleInstance
}

func WriteRelations(entityId string, entity string, subjectId string, subject string, relation string) error {
	ctx := context.Background()
	_, err := GetPermifyInstance().Data.WriteRelationships(
		ctx,
		&permify_payload.RelationshipWriteRequest{
			TenantId: "t1",
			Metadata: &permify_payload.RelationshipWriteRequestMetadata{
				SchemaVersion: "",
			},
			Tuples: []*permify_payload.Tuple{
				{
					Entity: &permify_payload.Entity{
						Type: entity,
						Id:   entityId,
					},
					Relation: relation,
					Subject: &permify_payload.Subject{
						Type: subject,
						Id:   subjectId,
					},
				},
			},
		},
	)
	return err
}

func GetEntitiesWithPermission(entity string, subject string, subjectId string, permission string) ([]string, error) {
	rr, err := GetPermifyInstance().Permission.LookupEntity(
		context.Background(),
		&permify_payload.PermissionLookupEntityRequest{
			TenantId: "t1",
			Metadata: &permify_payload.PermissionLookupEntityRequestMetadata{
				SchemaVersion: "",
				SnapToken:     "",
				Depth:         20,
			},
			EntityType: entity,
			Permission: permission,
			Subject: &permify_payload.Subject{
				Type:     subject,
				Id:       subjectId,
				Relation: "",
			},
		},
	)
	if err != nil {
		return make([]string, 0), err
	}
	return rr.GetEntityIds(), err
}

func CreateSubjectPermissions(entity string, entityId string, subject string, subjectId string, permission string) (string, error) {
	rr, err := GetPermifyInstance().Data.Write(
		context.Background(),
		&permify_payload.DataWriteRequest{
			TenantId: "t1",
			Metadata: &permify_payload.DataWriteRequestMetadata{
				SchemaVersion: "",
			},
			Tuples: []*permify_payload.Tuple{
				{
					Entity: &permify_payload.Entity{
						Type: entity,
						Id:   entityId,
					},
					Relation: permission,
					Subject: &permify_payload.Subject{
						Type:     subject,
						Id:       subjectId,
						Relation: "",
					},
				},
			},
		},
	)
	if err != nil {
		return "", err
	}
	return rr.SnapToken, err
}

func GetSubjectPermissionList(entity string, entityId string, subject string, subjectId string) map[string]permify_payload.CheckResult {
	client := GetPermifyInstance()
	var output map[string]permify_payload.CheckResult
	cr, err := client.Permission.SubjectPermission(
		context.Background(),
		&permify_payload.PermissionSubjectPermissionRequest{
			TenantId: "t1",
			Metadata: &permify_payload.PermissionSubjectPermissionRequestMetadata{
				SnapToken:      "",
				SchemaVersion:  "",
				OnlyPermission: false,
				Depth:          20,
			},
			Entity: &permify_payload.Entity{
				Type: entity,
				Id:   entityId,
			},
			Subject: &permify_payload.Subject{
				Type:     subject,
				Id:       subjectId,
				Relation: "",
			},
		},
	)
	if err != nil {
		Logger.Error(err.Error())
		return output
	}
	output = cr.GetResults()
	return output
}

func GetListOfEntitiesWithPermission(subject string, subjectId string, permission string, entity string) ([]string, error) {
	client := GetPermifyInstance()
	var entityIds []string
	str, err := client.Permission.LookupEntity(
		context.Background(),
		&permify_payload.PermissionLookupEntityRequest{
			TenantId: "t1",
			Metadata: &permify_payload.PermissionLookupEntityRequestMetadata{
				SchemaVersion: "",
				Depth:         20,
				SnapToken:     "",
			},
			EntityType: entity,
			Permission: permission,
			Subject: &permify_payload.Subject{
				Type: subject,
				Id:   subjectId,
			},
		},
	)
	if err != nil {
		Logger.Error(err.Error())
		return entityIds, err
	}
	entityIds = str.GetEntityIds()
	return entityIds, nil
}

func CheckPermission(entity string, entityId string, subject string, subjectId string, permission string) (bool, error) {
	cr, err := GetPermifyInstance().Permission.Check(
		context.Background(),
		&permify_payload.PermissionCheckRequest{
			TenantId: "t1",
			Metadata: &permify_payload.PermissionCheckRequestMetadata{
				SchemaVersion: "",
				SnapToken:     "",
				Depth:         20,
			},
			Entity: &permify_payload.Entity{
				Type: entity,
				Id:   entityId,
			},
			Permission: permission,
			Subject: &permify_payload.Subject{
				Type:     subject,
				Id:       subjectId,
				Relation: "",
			},
		},
	)
	if err != nil {
		Logger.Error(err.Error())
		return false, err
	}
	return cr.Can == permify_payload.CheckResult_CHECK_RESULT_ALLOWED, nil
}

func GetSubjectsAssociatedWithEntity(entity string, entityId string) ([]*permify_payload.Tuple, error) {

	client := GetPermifyInstance()
	data, err := client.Data.ReadRelationships(
		context.Background(),
		&permify_payload.RelationshipReadRequest{
			TenantId: "t1",
			Metadata: &permify_payload.RelationshipReadRequestMetadata{
				SnapToken: "",
			},
			Filter: &permify_payload.TupleFilter{
				Entity: &permify_payload.EntityFilter{
					Type: entity,
					Ids:  []string{entityId},
				},
			},
		},
	)

	if err != nil {
		Logger.Error(err.Error())
		return nil, err
	}
	return data.Tuples, nil
}
