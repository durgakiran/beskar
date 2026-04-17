package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

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
	DisplayNameQuery  *DisplayNameQuery     `json:"displayNameQuery,omitempty"`
	FirstNameQuery    *FirstNameQuery       `json:"firstNameQuery,omitempty"`
	LastNameQuery     *LastNameQuery        `json:"lastNameQuery,omitempty"`
	LoginNameQuery    *LoginNameQuery       `json:"loginNameQuery,omitempty"`
	UserNameQuery     *UserNameQuery        `json:"userNameQuery,omitempty"`
	OrQuery           *OrQuery              `json:"orQuery,omitempty"`
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

type DisplayNameQuery struct {
	DisplayName string `json:"displayName"`
	Method      string `json:"method"`
}

type FirstNameQuery struct {
	FirstName string `json:"firstName"`
	Method    string `json:"method"`
}

type LastNameQuery struct {
	LastName string `json:"lastName"`
	Method   string `json:"method"`
}

type LoginNameQuery struct {
	LoginName string `json:"loginName"`
	Method    string `json:"method"`
}

type UserNameQuery struct {
	UserName string `json:"userName"`
	Method   string `json:"method"`
}

type OrQuery struct {
	Queries []Filter `json:"queries"`
}

type UserSearchQuery struct {
	Query         Query    `json:"query"`
	SortingColumn string   `json:"sortingColumn"`
	Queries       []Filter `json:"queries"`
}

type Profile struct {
	GivenName   string `json:"givenName"`
	FamilyName  string `json:"familyName"`
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
	Id     string `json:"id"`
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
	var providerURL = normalizeExternalURL(os.Getenv("ISSUER_URL"))
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
	return runUserSearch(providerURL, query)
}

func SearchUserByEmail(search string, limit uint32, offset uint64) (UserSearchResponse, error) {
	var providerURL = normalizeExternalURL(os.Getenv("ISSUER_URL"))
	filter := Filter{
		InUserEmailsQuery: &InUserEmailsQuery{
			UserEmails: []string{strings.TrimSpace(strings.ToLower(search))},
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
	return runUserSearch(providerURL, query)
}

func SearchUsers(search string, limit uint32, offset uint64) (UserSearchResponse, error) {
	search = strings.TrimSpace(search)
	if search == "" {
		return UserSearchResponse{}, errors.New("missing search input")
	}
	var providerURL = normalizeExternalURL(os.Getenv("ISSUER_URL"))
	method := "TEXT_QUERY_METHOD_CONTAINS_IGNORE_CASE"
	orFilters := []Filter{
		{
			EmailQuery: &EmailQueryFilter{
				EmailAddress: search,
				Method:       method,
			},
		},
		{
			DisplayNameQuery: &DisplayNameQuery{
				DisplayName: search,
				Method:      method,
			},
		},
		{
			FirstNameQuery: &FirstNameQuery{
				FirstName: search,
				Method:    method,
			},
		},
		{
			LastNameQuery: &LastNameQuery{
				LastName: search,
				Method:   method,
			},
		},
		{
			LoginNameQuery: &LoginNameQuery{
				LoginName: search,
				Method:    method,
			},
		},
		{
			UserNameQuery: &UserNameQuery{
				UserName: search,
				Method:   method,
			},
		},
	}
	query := UserSearchQuery{
		Query: Query{
			Offset: offset,
			Limit:  limit,
			ASC:    true,
		},
		SortingColumn: "USER_FIELD_NAME_UNSPECIFIED",
		Queries: []Filter{
			{
				OrQuery: &OrQuery{
					Queries: orFilters,
				},
			},
		},
	}
	return runUserSearch(providerURL, query)
}

func runUserSearch(providerURL string, query UserSearchQuery) (UserSearchResponse, error) {
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
