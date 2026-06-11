import { ImageResponse } from "next/og";

// Branded social-share card. Mirrors the landing's "datasheet" aesthetic:
// dark ink ground, an indigo accent rule, the wordmark, the tagline, and a
// mono spec strip. Brand OKLCH tokens are approximated as hex (satori has no
// oklch support). 1200x630 is the standard OG/Twitter large-image size.
export const runtime = "nodejs";
export const alt = "BurnerByte — disposable email on infrastructure you own";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#13151e"; // background  (oklch 0.16 0.018 265)
const PAPER = "#f5f4f1"; // primary text
const MUTED = "#9ea2b5"; // secondary text
const INDIGO = "#818cf8"; // accent (on-dark indigo)

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          color: PAPER,
          padding: "76px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div style={{ width: "44px", height: "3px", background: INDIGO }} />
          <div style={{ fontSize: "23px", letterSpacing: "5px", color: MUTED }}>
            SELF-HOSTED MAIL INFRASTRUCTURE
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div style={{ fontSize: "104px", fontWeight: 700, letterSpacing: "-3px", lineHeight: 1 }}>
            BurnerByte
          </div>
          <div style={{ display: "flex", fontSize: "42px", color: "#c8cad6", maxWidth: "940px", lineHeight: 1.2 }}>
            Disposable email, on infrastructure you own.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "23px", color: MUTED }}>
          <div style={{ width: "11px", height: "11px", borderRadius: "9999px", background: INDIGO }} />
          <div style={{ display: "flex", letterSpacing: "2px" }}>
            REAL-TIME · SELF-HOSTED · APACHE-2.0
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
