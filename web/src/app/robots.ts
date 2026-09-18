import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://burnerbyte.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Allow search engines to index public pages
      {
        userAgent: "*",
        allow: ["/", "/login"],
        disallow: [
          "/dashboard",
          "/settings",
          "/profile",
          "/analytics",
          "/audit",
          "/api-keys",
          "/webhooks",
          "/teams",
          "/domains",
          "/inboxes",
          "/register",
          "/setup",
          "/onboarding",
          "/invite",
          "/reset-password",
          "/verify-email",
          "/api/",
        ],
      },
      // Block AI training crawlers — BurnerByte content is not for training
      {
        userAgent: "GPTBot",
        disallow: "/",
      },
      {
        userAgent: "ChatGPT-User",
        disallow: "/",
      },
      {
        userAgent: "OAI-SearchBot",
        allow: ["/"],
        disallow: ["/dashboard", "/settings", "/api/"],
      },
      {
        userAgent: "Claude-Web",
        disallow: "/",
      },
      {
        userAgent: "Google-Extended",
        disallow: "/",
      },
      {
        userAgent: "CCBot",
        disallow: "/",
      },
      {
        userAgent: "anthropic-ai",
        disallow: "/",
      },
      {
        userAgent: "Bytespider",
        disallow: "/",
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
