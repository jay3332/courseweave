/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Accounts and sync are served by the Worker: run `npm run dev:worker` alongside `npm run dev` for a full local
    // loop. Without it these requests fail and the app treats accounts as unavailable. FCE files are served
    // straight from public/ in dev (your own machine).
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
