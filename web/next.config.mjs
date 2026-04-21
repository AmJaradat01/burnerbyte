import { createMDX } from 'fumadocs-mdx/next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  async headers() {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://burnerbyte.com';
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Link',
            value: `</.well-known/api-catalog>; rel="api-catalog", <${siteUrl}/docs/api>; rel="service-doc", </docs/openapi.json>; rel="service-desc"`,
          },
        ],
      },
    ];
  },
};

const withMDX = createMDX();

export default withNextIntl(withMDX(config));
