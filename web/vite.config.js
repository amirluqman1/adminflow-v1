import { defineConfig } from 'vite';

// GitHub Pages serves the app under /adminflow-v1/; locally and on Cloudflare it lives at /.
// `npm run build:pages` sets the sub-path via .env.pages (VITE_BASE).
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/adminflow-v1/' : '/',
}));
