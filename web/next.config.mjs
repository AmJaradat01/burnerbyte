import { createMDX } from 'fumadocs-mdx/next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  async headers() {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://burnerbyte.com';
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/api/v1/ws';

    const securityHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-XSS-Protection', value: '0' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          `connect-src 'self' ${apiUrl} ${wsUrl} ${apiUrl.replace('/api/v1', '')} ${wsUrl.replace('/api/v1/ws', '')}`,
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "frame-src 'self'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; '),
      },
    ];

    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/',
        headers: [
          ...securityHeaders,
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
