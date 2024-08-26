package core

import (
	"context"
	"fmt"
	"os"
	"sync"

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
