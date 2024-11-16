package profile

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/durgakiran/beskar/core"
)

const profileEndpoint = "/protocol/openid-connect/userinfo"

func GetProfileData(token string) (core.UserInfoOut, error) {
	var realmUrl = os.Getenv("KC_REALM_URL")
	req, err := http.NewRequest(http.MethodGet, realmUrl+profileEndpoint, nil)
	if err != nil {
		return core.UserInfoOut{}, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return core.UserInfoOut{}, err
	}
	defer resp.Body.Close()
	var u core.UserInfo
	json.NewDecoder(resp.Body).Decode(&u)
	var outUserData core.UserInfoOut
	// outUserData = core.UserInfoOut(u)
	return outUserData, nil
}
