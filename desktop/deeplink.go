package main

import "net/url"

// Keep native URL events and second-instance launches on the same routing path.
func handleDeepLink(raw string, callback func(string), navigate func(string)) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "teddox" || u.User != nil || u.Host == "" {
		return
	}
	if u.Host == "callback" {
		if u.Path == "" {
			callback(raw)
		}
		return
	}
	navigate(raw)
}
