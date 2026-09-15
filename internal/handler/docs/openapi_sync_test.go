package docs_test

import (
	"encoding/json"
	"os"
	"regexp"
	"sort"
	"testing"
)

// The served OpenAPI document is hand-maintained, so it drifts from the router
// silently — it has carried operations for routes that do not exist (a DELETE
// on an org member, and /healthz and /readyz, which are served at the root and
// so 404 under the spec's /api/v1 server entry) while omitting whole groups
// such as the public demo endpoints. Anyone generating a client from it gets
// calls that cannot work, and no test failed.
//
// This compares the spec against the route registrations in the sources that
// define them, ignoring path-parameter names so {orgId} and {id} do not count
// as a difference.

var routeSources = []string{
	"../../../cmd/api/main.go",
	"../auth.go",
	"../try.go",
}

// Routes served at the root rather than under the /api/v1 server entry, and so
// deliberately absent from the document.
var rootRoutes = map[string]bool{
	"/healthz": true,
	"/readyz":  true,
}

var (
	reRoute  = regexp.MustCompile(`\.(Get|Post|Put|Patch|Delete)\("(/[^"]*)"`)
	reSetup  = regexp.MustCompile(`\.(Get|Post)\("(/[a-z-]+)"`)
	reParams = regexp.MustCompile(`\{[A-Za-z]+\}`)
)

type route struct{ method, path string }

func TestOpenAPIMatchesRouter(t *testing.T) {
	router := routerRoutes(t)
	spec := specRoutes(t)

	for r := range router {
		if !spec[r] {
			t.Errorf("%s %s is registered in the router but missing from openapi.json", r.method, r.path)
		}
	}
	for r := range spec {
		if !router[r] {
			t.Errorf("%s %s is in openapi.json but no such route is registered", r.method, r.path)
		}
	}

	if t.Failed() {
		t.Logf("router has %d operations, openapi.json has %d", len(router), len(spec))
	}
}

func routerRoutes(t *testing.T) map[route]bool {
	t.Helper()
	out := map[route]bool{}

	for _, f := range routeSources {
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		for _, m := range reRoute.FindAllStringSubmatch(string(src), -1) {
			p := m[2]
			if rootRoutes[p] {
				continue
			}
			out[route{lower(m[1]), normalize(p)}] = true
		}
	}

	// setup.go nests its routes inside r.Route("/setup", ...), so the literals
	// there are relative and need the prefix restored.
	src, err := os.ReadFile("../setup.go")
	if err != nil {
		t.Fatalf("read setup.go: %v", err)
	}
	for _, m := range reSetup.FindAllStringSubmatch(string(src), -1) {
		out[route{lower(m[1]), "/setup" + m[2]}] = true
	}
	return out
}

func specRoutes(t *testing.T) map[route]bool {
	t.Helper()
	raw, err := os.ReadFile("openapi.json")
	if err != nil {
		t.Fatalf("read openapi.json: %v", err)
	}
	var doc struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("openapi.json is not valid JSON: %v", err)
	}

	methods := map[string]bool{"get": true, "post": true, "put": true, "patch": true, "delete": true}
	out := map[route]bool{}
	for p, ops := range doc.Paths {
		for m := range ops {
			if methods[m] {
				out[route{m, normalize(p)}] = true
			}
		}
	}
	return out
}

// normalize erases path-parameter names so {orgId} and {id} compare equal.
func normalize(p string) string { return reParams.ReplaceAllString(p, "{}") }

func lower(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] += 'a' - 'A'
		}
	}
	return string(b)
}

// TestOpenAPIVersionIsCurrent keeps info.version from going stale, as it did
// for nine releases.
func TestOpenAPIVersionIsCurrent(t *testing.T) {
	raw, err := os.ReadFile("openapi.json")
	if err != nil {
		t.Fatalf("read openapi.json: %v", err)
	}
	var doc struct {
		Info struct{ Version string } `json:"info"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Info.Version == "" {
		t.Fatal("openapi.json info.version is empty")
	}

	changelog, err := os.ReadFile("../../../CHANGELOG.md")
	if err != nil {
		t.Skipf("CHANGELOG.md unreadable: %v", err)
	}
	m := regexp.MustCompile(`(?m)^## v(\d+\.\d+\.\d+)`).FindSubmatch(changelog)
	if m == nil {
		t.Skip("no versioned heading in CHANGELOG.md")
	}
	if got, want := doc.Info.Version, string(m[1]); got != want {
		var all []string
		for _, s := range regexp.MustCompile(`(?m)^## v(\d+\.\d+\.\d+)`).FindAllSubmatch(changelog, 3) {
			all = append(all, string(s[1]))
		}
		sort.Strings(all)
		t.Errorf("openapi.json info.version = %s but the newest CHANGELOG entry is %s", got, want)
	}
}
