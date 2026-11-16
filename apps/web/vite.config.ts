import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Lê as portas do .env da raiz (o mesmo do servidor).
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
    // App local servido de 127.0.0.1: um bundle único (~170 kB gzip) é aceitável.
    build: { chunkSizeWarningLimit: 800 },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
