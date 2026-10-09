import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});
