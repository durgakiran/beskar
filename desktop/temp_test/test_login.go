package main

import (
	"fmt"
	"net/url"
	"github.com/pkg/browser"
)

func main() {
	authURL := fmt.Sprintf("%s/oauth/v2/authorize?client_id=%s&redirect_uri=%s&response_type=code&scope=openid email offline_access&code_challenge=%s&code_challenge_method=S256",
		"https://id.durgakiran.com", "377926419071631362", url.QueryEscape("http://127.0.0.1:5999/callback"), "dummy", "S256")
	
	fmt.Println("Opening URL:", authURL)
	err := browser.OpenURL(authURL)
	if err != nil {
		fmt.Println("Error:", err)
	} else {
		fmt.Println("Success")
	}
}
