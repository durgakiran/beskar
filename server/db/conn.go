// database connection manager
package db

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func connCoreDB() *pgxpool.Pool {
	// os.Getenv("BESKAR_DATABASE_URL")
	dbpool, err := pgxpool.New(context.Background(), "postgresql://admin:password@localhost:5433/beskar")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Unable to connect to database: %v\n", err)
		os.Exit(1)
	}
	return dbpool
}

func GetCoreDBConn() *pgxpool.Pool {
	return connCoreDB()
}

func connDocDB() *mongo.Client {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found")
	}
	serverAPI := options.ServerAPI(options.ServerAPIVersion1)
	opts := options.Client().ApplyURI(os.Getenv("BESKAR_MONGODB_URI")).SetServerAPIOptions(serverAPI)

	client, err := mongo.Connect(context.TODO(), opts)

	if err != nil {
		panic(err)
	}

	return client
}

func GetDocDBConnection() *mongo.Client {
	return connDocDB()
}
