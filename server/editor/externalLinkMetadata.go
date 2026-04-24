package editor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/durgakiran/beskar/core"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const (
	maxExternalLinkMetadataBytes = 1 << 20
	maxExternalLinkRedirects     = 5
)

func getExternalLinkMetadataHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := core.GetUserInfo(ctx)
	if err != nil || user.Id == "" {
		core.SendFailedReponse(w, r, http.StatusForbidden, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_UNAUTHORIZED])
		return
	}

	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		core.SendFailedReponse(w, r, http.StatusBadRequest, core.ErrorCode_name[core.ErrorCode_ERROR_CODE_INVALID_INPUT])
		return
	}

	metadata, err := fetchExternalLinkMetadata(ctx, rawURL)
	if err != nil {
		logger().Error(fmt.Sprintf("getExternalLinkMetadataHandler: %s", err.Error()))
		switch {
		case errors.Is(err, errInvalidExternalLinkURL), errors.Is(err, errBlockedExternalLinkURL):
			core.SendFailedReponse(w, r, http.StatusBadRequest, err.Error())
		default:
			core.SendFailedReponse(w, r, http.StatusBadGateway, "Unable to resolve external link metadata")
		}
		return
	}

	core.SendSuccessResponse(w, r, http.StatusOK, metadata)
}

var (
	errInvalidExternalLinkURL = errors.New("invalid external link url")
	errBlockedExternalLinkURL = errors.New("blocked external link url")
)

func fetchExternalLinkMetadata(ctx context.Context, rawURL string) (*ExternalLinkMetadata, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" {
		return nil, errInvalidExternalLinkURL
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errInvalidExternalLinkURL
	}
	if err := validatePublicURL(ctx, parsed); err != nil {
		return nil, err
	}

	client := &http.Client{
		Timeout: 8 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxExternalLinkRedirects {
				return errors.New("too many redirects")
			}
			return validatePublicURL(ctx, req.URL)
		},
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
				host, _, splitErr := net.SplitHostPort(addr)
				if splitErr != nil {
					host = addr
				}
				if err := validateResolvedHost(ctx, host); err != nil {
					return nil, err
				}
				dialer := &net.Dialer{Timeout: 5 * time.Second}
				return dialer.DialContext(ctx, network, addr)
			},
		},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "BeskarLinkMetadataBot/1.0")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 400 {
		return nil, fmt.Errorf("unexpected status code: %d", response.StatusCode)
	}

	title, siteName, err := extractExternalLinkMetadata(io.LimitReader(response.Body, maxExternalLinkMetadataBytes))
	if err != nil {
		return nil, err
	}

	finalURL := response.Request.URL.String()
	finalHost := response.Request.URL.Hostname()
	if title == "" {
		title = hostnameLabel(finalHost)
	}
	if siteName == "" {
		siteName = hostnameLabel(finalHost)
	}

	return &ExternalLinkMetadata{
		URL:      finalURL,
		Title:    title,
		SiteName: siteName,
	}, nil
}

func extractExternalLinkMetadata(reader io.Reader) (string, string, error) {
	tokenizer := html.NewTokenizer(reader)

	var titleTag string
	var ogTitle string
	var twitterTitle string
	var ogSiteName string
	var readingTitle bool

	for {
		switch tokenizer.Next() {
		case html.ErrorToken:
			err := tokenizer.Err()
			if err == io.EOF {
				title := firstNonEmpty(ogTitle, twitterTitle, titleTag)
				return cleanHTMLText(title), cleanHTMLText(ogSiteName), nil
			}
			return "", "", err
		case html.StartTagToken, html.SelfClosingTagToken:
			token := tokenizer.Token()
			switch token.DataAtom {
			case atom.Title:
				readingTitle = true
			case atom.Meta:
				var metaName string
				var metaProperty string
				var metaContent string
				for _, attr := range token.Attr {
					switch strings.ToLower(attr.Key) {
					case "name":
						metaName = strings.ToLower(strings.TrimSpace(attr.Val))
					case "property":
						metaProperty = strings.ToLower(strings.TrimSpace(attr.Val))
					case "content":
						metaContent = strings.TrimSpace(attr.Val)
					}
				}
				switch {
				case metaProperty == "og:title" && ogTitle == "":
					ogTitle = metaContent
				case metaName == "twitter:title" && twitterTitle == "":
					twitterTitle = metaContent
				case metaProperty == "og:site_name" && ogSiteName == "":
					ogSiteName = metaContent
				}
			}
		case html.TextToken:
			if readingTitle && titleTag == "" {
				titleTag = tokenizer.Token().Data
			}
		case html.EndTagToken:
			token := tokenizer.Token()
			if token.DataAtom == atom.Title {
				readingTitle = false
			}
		}
	}
}

func validatePublicURL(ctx context.Context, parsed *url.URL) error {
	if parsed == nil || parsed.Hostname() == "" {
		return errInvalidExternalLinkURL
	}
	return validateResolvedHost(ctx, parsed.Hostname())
}

func validateResolvedHost(ctx context.Context, host string) error {
	normalizedHost := strings.TrimSpace(strings.Trim(host, "[]"))
	if normalizedHost == "" {
		return errInvalidExternalLinkURL
	}
	lowerHost := strings.ToLower(normalizedHost)
	if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".local") || strings.HasSuffix(lowerHost, ".internal") {
		return errBlockedExternalLinkURL
	}

	if ip := net.ParseIP(normalizedHost); ip != nil {
		if isBlockedIP(ip) {
			return errBlockedExternalLinkURL
		}
		return nil
	}

	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", normalizedHost)
	if err != nil {
		return err
	}
	if len(ips) == 0 {
		return errBlockedExternalLinkURL
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return errBlockedExternalLinkURL
		}
	}
	return nil
}

func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsPrivate() ||
		ip.IsLoopback() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified()
}

func hostnameLabel(host string) string {
	trimmed := strings.TrimPrefix(strings.TrimSpace(host), "www.")
	if trimmed == "" {
		return "external"
	}
	return trimmed
}

func cleanHTMLText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(html.UnescapeString(value))), " ")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
