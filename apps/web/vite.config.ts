import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Reads the ports from the root .env (the same as the server).
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), 'AGENT_BOARD_');
  const apiPort = Number(env.AGENT_BOARD_PORT || 9999);
  const webPort = Number(env.AGENT_BOARD_WEB_DEV_PORT || 5173);
  const target = `http://127.0.0.1:${apiPort}`;
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    server: {
      host: '127.0.0.1',
      port: webPort,
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/events': { target, changeOrigin: true },
      },
    },
    // A local app served from 127.0.0.1: a single bundle (~170 kB gzip) is acceptable.
    build: { chunkSizeWarningLimit: 800 },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
