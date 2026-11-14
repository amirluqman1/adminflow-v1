import { defineConfig } from 'vite';

// GitHub Pages serves the app under /adminflow-v1/; locally and on Cloudflare it lives at /.
// `npm run build:pages` (mode "pages") builds for the sub-path. In CI the Neon URLs come from the
// workflow env (.github/workflows/deploy-pages.yml); locally from web/.env.pages (git-ignored).
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/adminflow-v1/' : '/',
}));
