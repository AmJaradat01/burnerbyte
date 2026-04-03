"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", fontFamily: "system-ui, sans-serif" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "bold" }}>Something went wrong</h2>
          <p style={{ color: "#666" }}>{error.message}</p>
          <button
            onClick={reset}
            style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #ccc", cursor: "pointer", fontSize: "14px" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
