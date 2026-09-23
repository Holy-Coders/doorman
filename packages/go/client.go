// Package janitor calls an application-owned Janitor endpoint. Matching stays in
// your TypeScript or Elixir service; this client never collects server fingerprints.
package janitor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const MaxBodyBytes = 32768
const maxResponseBytes = 65536

var ErrUnavailable = errors.New("janitor endpoint unavailable")

// Client can be shared across requests. It has no shared cookie jar.
type Client struct {
	endpoint string
	token    string
	http     *http.Client
}
type Options struct {
	Timeout     time.Duration
	BearerToken string
}
type Request struct {
	Signals  map[string]any `json:"signals"`
	Behavior map[string]any `json:"behavior,omitempty"`
}
type Context struct {
	Cookie    string
	Origin    string
	CSRFToken string
}
type Result struct {
	VisitorID   string   `json:"visitorId"`
	IsReturning bool     `json:"isReturning"`
	SetCookies  []string `json:"-"`
}

func NewClient(endpoint string, options Options) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errors.New("expected absolute Janitor endpoint without credentials or query")
	}
	if u.Scheme == "http" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
		return nil, errors.New("use HTTPS except for loopback development")
	}
	if options.Timeout == 0 {
		options.Timeout = 3 * time.Second
	}
	if options.Timeout < 0 || options.Timeout > 30*time.Second || !header(options.BearerToken, 8192) {
		return nil, errors.New("invalid Janitor options")
	}
	return &Client{endpoint, options.BearerToken, &http.Client{Timeout: options.Timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (c *Client) Identify(ctx context.Context, input Request, browser Context) (Result, error) {
	var empty Result
	if input.Signals == nil {
		input.Signals = map[string]any{}
	}
	data, err := json.Marshal(input)
	if err != nil || len(data) > MaxBodyBytes {
		return empty, errors.New("invalid or oversized measurement payload")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(data))
	if err != nil {
		return empty, ErrUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	for _, h := range []struct {
		name, value string
		limit       int
	}{{"Cookie", browser.Cookie, 8192}, {"Origin", browser.Origin, 2048}, {"X-CSRF-Token", browser.CSRFToken, 4096}} {
		if !header(h.value, h.limit) {
			return empty, errors.New("invalid forwarding header")
		}
		if h.value != "" {
			req.Header.Set(h.name, h.value)
		}
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return empty, ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || strings.TrimSpace(strings.Split(res.Header.Get("Content-Type"), ";")[0]) != "application/json" {
		return empty, ErrUnavailable
	}
	data, err = io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return empty, ErrUnavailable
	}
	var value struct {
		VisitorID   string `json:"visitorId"`
		IsReturning *bool  `json:"isReturning"`
	}
	if json.Unmarshal(data, &value) != nil || !visitorID(value.VisitorID) || value.IsReturning == nil {
		return empty, ErrUnavailable
	}
	cookies := res.Header.Values("Set-Cookie")
	if len(cookies) > 8 {
		return empty, ErrUnavailable
	}
	for _, cookie := range cookies {
		if !header(cookie, 4096) {
			return empty, ErrUnavailable
		}
	}
	return Result{value.VisitorID, *value.IsReturning, cookies}, nil
}

// Handler relays only measurements and the public result, leaving scores private.
// Mount behind your application's same-origin/CSRF and request-rate controls.
func (c *Client) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			http.Error(w, "method not allowed", 405)
			return
		}
		if strings.TrimSpace(strings.Split(r.Header.Get("Content-Type"), ";")[0]) != "application/json" {
			http.Error(w, "JSON required", 415)
			return
		}
		raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBodyBytes))
		if err != nil {
			http.Error(w, "payload too large", 413)
			return
		}
		var input Request
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil {
			http.Error(w, "invalid payload", 400)
			return
		}
		if decoder.Decode(new(any)) != io.EOF {
			http.Error(w, "invalid payload", 400)
			return
		}
		result, err := c.Identify(r.Context(), input, Context{r.Header.Get("Cookie"), r.Header.Get("Origin"), r.Header.Get("X-CSRF-Token")})
		if err != nil {
			http.Error(w, "identity unavailable", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		for _, cookie := range result.SetCookies {
			w.Header().Add("Set-Cookie", cookie)
		}
		_ = json.NewEncoder(w).Encode(result)
	})
}
func header(s string, limit int) bool {
	if len(s) > limit {
		return false
	}
	for _, c := range s {
		if c < 32 || c > 126 {
			return false
		}
	}
	return true
}
func visitorID(s string) bool {
	if len(s) != 52 || !strings.HasPrefix(s, "vis_") {
		return false
	}
	for _, c := range s[4:] {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return false
		}
	}
	return true
}
