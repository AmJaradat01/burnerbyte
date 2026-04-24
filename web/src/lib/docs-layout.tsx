import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'BurnerByte Docs',
      url: '/docs',
    },
    links: [
      { text: 'App', url: '/dashboard' },
      { text: 'Getting Started', url: '/docs/getting-started/quick-start' },
      { text: 'API Reference', url: '/docs/api' },
      { text: 'Self-Hosting', url: '/docs/self-hosting/production' },
      {
        text: 'GitLab',
        url: 'https://gitlab.com/burnerbyte/burnerbyte',
        external: true,
      },
    ],
  };
}
