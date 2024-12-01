package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	createUserId = "INSERT INTO core.user_id_map (zita_id, user_id) VALUES ($1, $2);"
	getUserId    = "SELECT user_id FROM core.user_id_map WHERE zita_id = $1;"
	getZitaIds   = "SELECT user_id, zita_id FROM core.user_id_map WHERE user_id = ANY($1);"
)

// search users
type Query struct {
	Offset uint64 `json:"offset"`
	Limit  uint32 `json:"limit"`
	ASC    bool   `json:"asc"`
}

type Filter struct {
	InUserIdsQuery    *InUserIdsQUeryFilter `json:"inUserIdsQuery,omitempty"`
	EmailQuery        *EmailQueryFilter     `json:"emailQuery,omitempty"`
	InUserEmailsQuery *InUserEmailsQuery    `json:"inUserEmailsQuery,omitempty"`
}

type InUserIdsQUeryFilter struct {
	UserIds []string `json:"userIds"`
}

type EmailQueryFilter struct {
	EmailAddress string `json:"emailAddress"`
	Method       string `json:"method"`
}

type InUserEmailsQuery struct {
	UserEmails []string `json:"userEmails"`
}

type UserSearchQuery struct {
	Query         Query    `json:"query"`
	SortingColumn string   `json:"sortingColumn"`
	Queries       []Filter `json:"queries"`
}

type Profile struct {
	DisplayName string `json:"displayName"`
	Gender      string `json:"gender"`
}

type EmailAddress struct {
	Email      string `json:"email"`
	IsVerified bool   `json:"isVerified"`
}

type Human struct {
	UserId  string       `json:"userId"`
	Profile Profile      `json:"profile"`
	Email   EmailAddress `json:"email"`
}

type User struct {
	UserId string `json:"userId"`
	Human  Human  `json:"human"`
}

type Details struct {
	TotalResult string `json:"totalResult"`
}

type UserSearchResponse struct {
	Details Details `json:"details"`
	Result  []User  `json:"result"`
}

type ZitaUser struct {
	UserId string `json:"userId" db:"user_id"`
	Id     string `json:"id" db:"zita_id"`
}

func SearchUsersByIds(userIds []string) (UserSearchResponse, error) {
	var providerURL = os.Getenv("ISSUER_URL")
	// providerURL := "http://app.tededox.com"
	filter := Filter{
		InUserIdsQuery: &InUserIdsQUeryFilter{
			UserIds: userIds,
		},
	}
	filters := make([]Filter, 0)
	filters = append(filters, filter)
	var query = UserSearchQuery{
		Query: Query{
			Offset: 0,
			Limit:  10,
			ASC:    true,
		},
		SortingColumn: "USER_FIELD_NAME_UNSPECIFIED",
		Queries:       filters,
	}
	jsonData, err := json.Marshal(query)
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	req, err := http.NewRequest(http.MethodPost, providerURL+"/v2/users", bytes.NewReader(jsonData))
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("SERVER_PAT"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Add("Accept", "application/json")
	httpClient := &http.Client{}
	resp, err := httpClient.Do(req)
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	defer resp.Body.Close()
	var users UserSearchResponse
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	err = json.Unmarshal(data, &users)
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	return users, nil
}

func SearchUserByEmail(search string, limit uint32, offset uint64) (UserSearchResponse, error) {
	var providerURL = os.Getenv("ISSUER_URL")
	// providerURL := "http://app.tededox.com"
	filter := Filter{
		InUserEmailsQuery: &InUserEmailsQuery{
			UserEmails: []string{search},
		},
	}
	filters := make([]Filter, 0)
	filters = append(filters, filter)
	var query = UserSearchQuery{
		Query: Query{
			Offset: offset,
			Limit:  limit,
			ASC:    true,
		},
		SortingColumn: "USER_FIELD_NAME_UNSPECIFIED",
		Queries:       filters,
	}
	jsonData, err := json.Marshal(query)
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	fmt.Println(string(jsonData))
	req, err := http.NewRequest(http.MethodPost, providerURL+"/v2/users", bytes.NewReader(jsonData))
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+os.Getenv("SERVER_PAT"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Add("Accept", "application/json")
	httpClient := &http.Client{}
	resp, err := httpClient.Do(req)
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	defer resp.Body.Close()
	var users UserSearchResponse
	data, err := io.ReadAll(resp.Body)
	fmt.Println(string(data))
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	err = json.Unmarshal(data, &users)
	if err != nil {
		Logger.Error(err.Error())
		return UserSearchResponse{}, err
	}
	return users, nil
}

func GetBeskarUser(zitadelId string) (string, error) {
	var userId string
	connPool := GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		Logger.Error("Unable to acquire a connection: " + err.Error())
		return userId, err
	}
	defer conn.Release()
	err = conn.QueryRow(ctx, getUserId, zitadelId).Scan(&userId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// create new user id
			_, err = conn.Exec(ctx, createUserId, zitadelId, uuid.New().String())
			if err != nil {
				Logger.Error("Unable to create new user id: " + err.Error())
				return userId, err
			}
			// get new user id
			err = conn.QueryRow(ctx, getUserId, zitadelId).Scan(&userId)
			if err != nil {
				Logger.Error("Unable to get user id: " + err.Error())
				return userId, err
			}
		}
		Logger.Error("Unable to get user id: " + err.Error())
	}
	return userId, err
}

func GetUserInfo(ctx context.Context) (UserInfo, error) {
	var user UserInfo
	mw := ZitadelMiddleware()
	authContex := mw.Context(ctx)
	data, err := json.MarshalIndent(authContex.UserInfo, "", "	")
	if err != nil {
		Logger.Error(err.Error())
		return user, err
	}
	err = json.Unmarshal(data, &user)
	if err != nil {
		Logger.Error(err.Error())
		return user, err
	}
	// get app id
	id, err := GetBeskarUser(user.Id)
	if err != nil {
		Logger.Error(err.Error())
		return user, err
	}
	user.AId = id
	return user, err
}

func GetZitaIds(userIds []string) ([]ZitaUser, error) {
	var zitaIds []ZitaUser
	connPool := GetPool()
	ctx := context.Background()
	conn, err := connPool.Acquire(ctx)
	if err != nil {
		Logger.Error("Unable to acquire a connection: " + err.Error())
		return zitaIds, err
	}
	defer conn.Release()
	rows, err := conn.Query(ctx, getZitaIds, userIds)
	if err != nil {
		Logger.Error("Unable to get zitad ids: " + err.Error())
		return zitaIds, err
	}
	zitaIds, err = pgx.CollectRows(rows, pgx.RowToStructByName[ZitaUser])
	if err != nil {
		Logger.Error("Unable to read zitad ids: " + err.Error())
		return zitaIds, err
	}
	return zitaIds, nil
}
