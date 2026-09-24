import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react()],
    base: command === 'serve' ? '/' : (env.VITE_BASE_PATH || '/safetyreport-community-map/'),
    build: { outDir: 'dist', sourcemap: false, emptyOutDir: true },
    test: { environment: 'node' },
  };
});
