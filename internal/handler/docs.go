package handler

import (
	"embed"
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

func SwaggerUI(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>BurnerByte API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: "/api/v1/docs/openapi.json", dom_id: "#swagger-ui" });</script>
</body>
</html>`))
}
