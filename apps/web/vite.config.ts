import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Cible de l'API en développement ; la suite e2e la redirige vers son API de test.
const apiProxy = { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
});
