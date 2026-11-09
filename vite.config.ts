/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const RENDER_PORT = Number(process.env.RASD_RENDER_PORT ?? 3210);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: `http://127.0.0.1:${RENDER_PORT}`, changeOrigin: true } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: `http://127.0.0.1:${RENDER_PORT}`, changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          charts: ['recharts'],
          remotion: ['remotion', '@remotion/player'],
          turf: ['@turf/turf'],
        },
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
});
