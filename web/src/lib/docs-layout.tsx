import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: '🔥 BurnerByte Docs',
      url: '/docs',
    },
    links: [
      { text: 'App', url: '/dashboard' },
      { text: 'API Reference', url: '/docs/api' },
      { text: 'GitHub', url: 'https://gitlab.com/amjaradat01/burnerbyte', external: true },
    ],
  };
}
