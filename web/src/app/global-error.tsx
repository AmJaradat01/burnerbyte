"use client";

// Renders in place of the root layout when the layout itself throws, so the
// app's Tailwind/theme/fonts are not available here. Styles are therefore
// inline, with neutrals tinted toward the brand indigo instead of flat grays.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            padding: "24px",
            textAlign: "center",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: "#14151b",
            background: "#f8fafd",
          }}
        >
          <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            Burner<span style={{ color: "#2459e2" }}>Byte</span>
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: 600, margin: "8px 0 0" }}>Something went wrong</h1>
          <p style={{ color: "#535861", maxWidth: "28rem", lineHeight: 1.5, margin: 0 }}>
            An unexpected error interrupted the page. Try again, or contact support if it keeps happening.
          </p>
          {error.digest && (
            <p style={{ color: "#8a8f99", fontSize: "12px", fontFamily: "ui-monospace, monospace", margin: 0 }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              marginTop: "8px",
              padding: "9px 18px",
              borderRadius: "9px",
              border: "none",
              background: "#2459e2",
              color: "#f8fafd",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
