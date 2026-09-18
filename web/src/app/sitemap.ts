import type { MetadataRoute } from "next";

// The documentation is published at burnerbyte.com/docs from this repo's own
// web/content/docs, not served by this app. Listing it here would have every
// self-hosted instance claim authorship of the same twenty-seven URLs.

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://burnerbyte.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
