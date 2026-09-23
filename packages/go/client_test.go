package doorman

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPublicProjectionAndCookies(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]bool{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen[r.Header.Get("Cookie")] = true
		mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer server-secret" {
			t.Error("missing service authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Add("Set-Cookie", "one=a; Secure")
		w.Header().Add("Set-Cookie", "two=b; Secure")
		_ = json.NewEncoder(w).Encode(map[string]any{"visitorId": "vis_" + strings.Repeat("a", 48), "isReturning": true, "risk": map[string]any{"automation": 1}, "debug": "private"})
	}))
	defer server.Close()
	client, _ := NewClient(server.URL, Options{BearerToken: "server-secret"})
	var wg sync.WaitGroup
	for _, cookie := range []string{"person=a", "person=b", ""} {
		wg.Add(1)
		go func(cookie string) {
			defer wg.Done()
			result, err := client.Identify(context.Background(), Request{}, Context{Cookie: cookie})
			if err != nil {
				t.Error(err)
				return
			}
			data, _ := json.Marshal(result)
			if strings.Contains(string(data), "risk") || len(result.SetCookies) != 2 {
				t.Error("private projection/cookie failure")
			}
		}(cookie)
	}
	wg.Wait()
	if len(seen) != 3 {
		t.Error(seen)
	}
}
func TestRejectRedirectMalformedOversized(t *testing.T) {
	for _, body := range []string{`{"visitorId":"bad","isReturning":true}`, `{"visitorId":"vis_` + strings.Repeat("a", 48) + `"}`, strings.Repeat("x", 70000)} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(body))
		}))
		client, _ := NewClient(server.URL, Options{})
		if _, err := client.Identify(context.Background(), Request{}, Context{}); err == nil {
			t.Error("accepted invalid response")
		}
		server.Close()
	}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; http.Redirect(w, r, "/redirect", 302) }))
	defer server.Close()
	client, _ := NewClient(server.URL, Options{})
	_, err := client.Identify(context.Background(), Request{}, Context{})
	if err == nil || calls != 1 {
		t.Fatal(err, calls)
	}
}
func TestCancellationAndTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(100 * time.Millisecond) }))
	defer server.Close()
	client, _ := NewClient(server.URL, Options{Timeout: 20 * time.Millisecond})
	start := time.Now()
	_, err := client.Identify(context.Background(), Request{}, Context{})
	if err == nil || time.Since(start) > time.Second {
		t.Fatal("deadline not enforced")
	}
}
func TestHandlerRejectsInvalidInput(t *testing.T) {
	client, _ := NewClient("http://localhost:1/api/visitor", Options{})
	for _, body := range []string{`{} {}`, `{"actor":{"verified":true}}`, strings.Repeat("x", 33000)} {
		req := httptest.NewRequest("POST", "/api/visitor", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		client.Handler().ServeHTTP(w, req)
		if w.Code != 400 && w.Code != 413 {
			t.Error(w.Code)
		}
	}
	if _, err := NewClient("http://external.example/api", Options{}); err == nil {
		t.Error("insecure external URL accepted")
	}
	if _, err := client.Identify(context.Background(), Request{}, Context{Cookie: "x\r\nBad: value"}); err == nil {
		t.Error("header injection accepted")
	}
}
