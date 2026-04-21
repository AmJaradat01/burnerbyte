import { NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://burnerbyte.com";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || `${BASE_URL}/api/v1`;

export function GET() {
  const catalog = {
    linkset: [
      {
        anchor: `${API_BASE}/`,
        "service-desc": [
          {
            href: `${API_BASE}/docs/openapi.json`,
            type: "application/openapi+json;version=3.0",
          },
        ],
        "service-doc": [
          {
            href: `${BASE_URL}/docs/api`,
            type: "text/html",
          },
        ],
        status: [
          {
            href: `${BASE_URL}/healthz`,
            type: "application/json",
          },
        ],
      },
    ],
  };

  return NextResponse.json(catalog, {
    headers: {
      "Content-Type": "application/linkset+json",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
