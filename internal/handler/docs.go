package handler

import (
	"embed"
	"fmt"
	"net/http"
)

//go:embed docs/openapi.json
var docsFS embed.FS

func OpenAPISpec(w http.ResponseWriter, r *http.Request) {
	data, err := docsFS.ReadFile("docs/openapi.json")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "spec not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Write(data)
}

// Swagger UI's assets are pinned to an exact version and integrity-checked.
// They used to be requested as "swagger-ui-dist@5", a floating major range
// with no subresource integrity: unpkg served whatever @5 resolved to at
// request time, so a compromised release or CDN would have run arbitrary
// JavaScript on the API's own origin. With an exact version and a SHA-384
// digest the browser refuses anything that is not byte-for-byte this file.
const (
	swaggerVersion   = "5.29.0"
	swaggerCSSHash   = "sha384-++DMKo1369T5pxDNqojF1F91bYxYiT1N7b1M15a7oCzEodfljztKlApQoH6eQSKI"
	swaggerJSHash    = "sha384-fU7N0ipr7Rsi0J81QNqlN7WXb/tyAL8b16lEAJ2a01m7wdX+RU61ggqmxn8p3aJb"
	swaggerAssetHost = "https://unpkg.com"
)

func SwaggerUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	// The API-wide policy is script-src 'self', which is right for endpoints
	// that return JSON but blocks this page's own assets. Narrow the policy
	// for this one route rather than loosening it everywhere: the CDN is
	// allowed only for the script and stylesheet, both integrity-pinned, and
	// connect-src stays 'self' so the page can only talk back to this API.
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; "+
			"script-src 'self' 'unsafe-inline' "+swaggerAssetHost+"; "+
			"style-src 'self' 'unsafe-inline' "+swaggerAssetHost+"; "+
			"img-src 'self' data:; font-src 'self' data:; connect-src 'self'")
	fmt.Fprintf(w, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BurnerByte API Docs</title>
  <link rel="stylesheet" href="%[1]s/swagger-ui-dist@%[2]s/swagger-ui.css" integrity="%[3]s" crossorigin="anonymous">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="%[1]s/swagger-ui-dist@%[2]s/swagger-ui-bundle.js" integrity="%[4]s" crossorigin="anonymous"></script>
  <script>SwaggerUIBundle({ url: "/api/v1/docs/openapi.json", dom_id: "#swagger-ui" });</script>
</body>
</html>`, swaggerAssetHost, swaggerVersion, swaggerCSSHash, swaggerJSHash)
}
