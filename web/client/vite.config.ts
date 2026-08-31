import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string };

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT_SHA__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 8)),
    __VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
  preview: {
    port: 4173,
    // Tailscale Funnel forwards the public host header; without this the
    // preview server's anti-DNS-rebinding check 403s every request.
    allowedHosts: ['desktop-f30p0l1.tail3fe6fb.ts.net'],
    // Same-origin serving for production builds (Tailscale Funnel, nginx):
    // the static client and the API share one origin.
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
