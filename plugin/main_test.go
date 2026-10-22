package main

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegister(t *testing.T) {
	raw, err := handleMethod("plugin.register", nil)
	if err != nil {
		t.Fatal(err)
	}
	var e envelope
	if err := json.Unmarshal(raw, &e); err != nil || !e.OK {
		t.Fatalf("register: %s %v", raw, err)
	}
}

func mgmtReq(path, method string) []byte {
	req, _ := json.Marshal(map[string]interface{}{
		"result": map[string]interface{}{
			"Method":  method,
			"Path":    path,
			"Query":   map[string][]string{"start": {"2026-09-09"}, "end": {"2026-09-18"}, "bucket": {"day"}},
			"Headers": map[string][]string{},
			"Body":    nil,
		},
	})
	return req
}

func callMgmt(t *testing.T, path, method string) (int, string, []byte) {
	t.Helper()
	raw, err := handleMethod("management.handle", mgmtReq(path, method))
	if err != nil {
		t.Fatal(err)
	}
	var e envelope
	if err := json.Unmarshal(raw, &e); err != nil || !e.OK {
		t.Fatalf("handle %s: %s %v", path, raw, err)
	}
	var resp struct {
		StatusCode int
		Headers    map[string][]string
		Body       []byte
	}
	if err := json.Unmarshal(e.Result, &resp); err != nil {
		t.Fatal(err)
	}
	ct := ""
	if v := resp.Headers["content-type"]; len(v) > 0 {
		ct = v[0]
	}
	return resp.StatusCode, ct, resp.Body
}

func TestManagementReport(t *testing.T) {
	status, ct, body := callMgmt(t, "/v0/resource/plugins/usage-report/report", "GET")
	if status != 200 || len(body) < 300 {
		t.Fatalf("page: %d %s %d bytes", status, ct, len(body))
	}
	t.Logf("page ok: %d bytes, %s", len(body), ct)

	status, ct, js := callMgmt(t, "/v0/resource/plugins/usage-report/assets/index-DF0Jn0AW.js", "GET")
	if status != 200 || len(js) < 100000 {
		t.Fatalf("js: %d %s %d bytes", status, ct, len(js))
	}
	t.Logf("js ok: %d bytes, %s", len(js), ct)
}

func TestManagementAPI(t *testing.T) {
	openDB(filepath.Join(t.TempDir(), "test.sqlite"))
	seed := []byte(`{"result":{"Provider":"codex","Model":"gpt-ci-test","Source":"sk-ci","RequestedAt":"2026-09-10T11:30:00+08:00","Detail":{"InputTokens":100,"OutputTokens":20,"CacheReadTokens":80,"TotalTokens":120},"Failed":false}}`)
	if _, err := handleMethod("usage.handle", seed); err != nil {
		t.Fatal(err)
	}
	status, _, body := callMgmt(t, "/v0/management/plugins/usage-report/api/usage", "GET")
	if status != 200 {
		t.Fatalf("usage api: %d %s", status, body)
	}
	var data struct {
		Events  []map[string]interface{} `json:"events"`
		Buckets []map[string]interface{} `json:"buckets"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		t.Fatalf("decode: %v body=%s", err, body[:200])
	}
	if len(data.Events) != 1 {
		t.Fatalf("expect 1 event, got %d", len(data.Events))
	}
	if got := data.Events[0]["model"]; got != "gpt-ci-test" {
		t.Fatalf("unexpected model: %v", got)
	}
	t.Logf("usage api ok: %d events, %d buckets", len(data.Events), len(data.Buckets))
}

func TestUsageHandle(t *testing.T) {
	openDB(filepath.Join(t.TempDir(), "test.sqlite"))
	req := []byte(`{"result":{"Provider":"codex","Model":"gpt-6-astra","Source":"sk-test","RequestedAt":"2026-09-18T11:30:00+08:00","Latency":1500000000,"TTFT":250000000,"Detail":{"InputTokens":100,"OutputTokens":20,"ReasoningTokens":5,"CachedTokens":80,"CacheReadTokens":80,"TotalTokens":120},"Failed":false}}`)
	raw, err := handleMethod("usage.handle", req)
	if err != nil {
		t.Fatal(err)
	}
	var e envelope
	if err := json.Unmarshal(raw, &e); err != nil || !e.OK {
		t.Fatalf("usage.handle: %s %v", raw, err)
	}
	var n int
	mu.Lock()
	_ = db.QueryRow("SELECT COUNT(*) FROM usage_events").Scan(&n)
	mu.Unlock()
	if n != 1 {
		t.Fatalf("expect 1 row, got %d", n)
	}
	t.Logf("usage.handle wrote %d row", n)
}

func TestApplyConfig(t *testing.T) {
	tmp := t.TempDir()
	direct := []byte(`{"config_yaml":"enabled: true\ndb_path: \"` + tmp + `/direct.sqlite\"\n"}`)
	applyConfig(direct)
	if lastOpened != tmp+"/direct.sqlite" {
		t.Fatalf("direct shape: got %q", lastOpened)
	}
	wrapped := []byte(`{"result":{"config_yaml":"db_path: ` + tmp + `/wrapped.sqlite"}}`)
	applyConfig(wrapped)
	if lastOpened != tmp+"/wrapped.sqlite" {
		t.Fatalf("wrapped shape: got %q", lastOpened)
	}
	// CLIProxyAPI marshals config_yaml from a []byte field, i.e. base64.
	host, err := json.Marshal(struct {
		ConfigYAML    []byte `json:"config_yaml"`
		SchemaVersion uint32 `json:"schema_version"`
	}{ConfigYAML: []byte("enabled: true\ndb_path: \"" + tmp + "/host.sqlite\"\n"), SchemaVersion: 1})
	if err != nil {
		t.Fatal(err)
	}
	applyConfig(host)
	if lastOpened != tmp+"/host.sqlite" {
		t.Fatalf("host shape: got %q", lastOpened)
	}
}

func TestUsageGroupsByClientKey(t *testing.T) {
	openDB(filepath.Join(t.TempDir(), "clients.sqlite"))
	record := func(apiKey, source string, minute int) {
		handleUsage([]byte(fmt.Sprintf(`{"result":{"Provider":"claude","Model":"m","APIKey":%q,"Source":%q,"RequestedAt":"2026-09-10T11:%02d:00+08:00","Detail":{"InputTokens":10,"OutputTokens":5,"TotalTokens":15}}}`, apiKey, source, minute)))
	}
	record("sk-first-key-95", "acct@example.com", 1)
	record("sk-other-key-95", "acct@example.com", 2)
	record("sk-third-key-V7", "other@example.com", 3)
	record("", "acct@example.com", 4)
	status, _, body := callMgmt(t, "/v0/management/plugins/usage-report/api/usage", "GET")
	if status != 200 {
		t.Fatalf("HTTP %d: %s", status, body)
	}
	if strings.Contains(string(body), "first-key") || strings.Contains(string(body), "third-key") {
		t.Fatal("API exposed client key")
	}
	var response struct{ Events []outEvent }
	if err := json.Unmarshal(body, &response); err != nil || len(response.Events) != 4 {
		t.Fatalf("bad response: %s %v", body, err)
	}
	ev := response.Events
	if ev[0].Client == ev[1].Client || !strings.HasPrefix(ev[0].Client, "sk******95 · ") || !strings.HasPrefix(ev[1].Client, "sk******95 · ") {
		t.Fatalf("keys sharing a mask must stay apart: %q %q", ev[0].Client, ev[1].Client)
	}
	if ev[2].Client != "sk******V7" || ev[3].Client != "" {
		t.Fatalf("clients: %q %q", ev[2].Client, ev[3].Client)
	}
	if ev[0].Key != anonKey("acct@example.com") || ev[2].Key != anonKey("other@example.com") {
		t.Fatalf("account grouping changed: %q %q", ev[0].Key, ev[2].Key)
	}
}

func TestOpenDBCreatesParentDir(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing", "usage.sqlite")
	openDB(path)
	if lastOpened != path || lastErr != "" {
		t.Fatalf("got %q, err %q", lastOpened, lastErr)
	}
}

func TestManagementRegisterRoutes(t *testing.T) {
	raw, err := handleMethod("management.register", nil)
	if err != nil {
		t.Fatal(err)
	}
	var e envelope
	if err := json.Unmarshal(raw, &e); err != nil || !e.OK {
		t.Fatalf("register: %s %v", raw, err)
	}
	var reg struct {
		Routes []struct {
			Method string
			Path   string
		}
		Resources []struct {
			Path string
		}
	}
	if err := json.Unmarshal(e.Result, &reg); err != nil {
		t.Fatal(err)
	}
	if len(reg.Routes) != 6 {
		t.Fatalf("expect 6 authenticated routes, got %d", len(reg.Routes))
	}
	for _, r := range reg.Routes {
		if r.Method != "GET" && r.Method != "POST" {
			t.Fatalf("route %s missing explicit method", r.Path)
		}
		if !strings.HasPrefix(r.Path, "/plugins/usage-report/api/") {
			t.Fatalf("route outside plugin namespace: %s", r.Path)
		}
	}
	for _, r := range reg.Resources {
		if strings.Contains(r.Path, "/api/") {
			t.Fatalf("dynamic api must not be registered as resource: %s", r.Path)
		}
	}
}
