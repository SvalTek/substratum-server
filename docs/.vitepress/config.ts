import { defineConfig } from 'vitepress';

const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.DOCS_BASE ?? (process.env.GITHUB_ACTIONS && repo ? `/${repo}/` : '/');

export default defineConfig({
  title: 'Substratum Server',
  description: 'Persistent spatial runtime, SQLite storage, Astro dashboard, and HTTP/SSE API for Substratum.',
  base,
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Plugins', link: '/plugins/typescript' },
      { text: 'Dashboard', link: '/dashboard/' },
      { text: 'API', link: '/api/' },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/SvalTek/substratum-server' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration & Deployment', link: '/guide/configuration' },
          { text: 'Authentication & Clients', link: '/guide/authentication' },
          { text: 'Storage & Snapshots', link: '/guide/storage' },
          { text: 'Streaming & Events', link: '/guide/streaming' },
        ],
      },
      {
        text: 'Plugins',
        items: [
          { text: 'TypeScript Plugins', link: '/plugins/typescript' },
          { text: 'Lua Plugins & Modules', link: '/plugins/lua' },
        ],
      },
      {
        text: 'Dashboard',
        items: [
          { text: 'Dashboard & Atlas', link: '/dashboard/' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview & OpenAPI', link: '/api/' },
          { text: 'Runtime & Geometry', link: '/api/runtime-and-geometry' },
          { text: 'Content, Cells & Placements', link: '/api/content-and-cells' },
          { text: 'Queries, Events & Activity', link: '/api/queries-and-events' },
          { text: 'Administration & Auth', link: '/api/administration' },
        ],
      },
    ],

    search: {
      provider: 'local',
    },

    outline: {
      level: [2, 3],
    },

    footer: {
      message: 'Substratum Server — Persistent spatial runtime, dashboard, and HTTP/SSE API.',
    },
  },
});
