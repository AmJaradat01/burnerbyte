import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'BurnerByte Docs',
      url: '/docs',
    },
    // Only destinations the page tree does not already carry. Getting Started,
    // API Reference and Self-Hosting used to live here too, so each appeared
    // three times in the sidebar: once as a link, once as a separator, and once
    // as its folder.
    links: [
      { text: 'App', url: '/' },
      {
        text: 'GitLab',
        url: 'https://gitlab.com/amjaradat01/burnerbyte',
        external: true,
      },
    ],
  };
}
