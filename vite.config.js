import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the game is served from its own origin on Onceworlds.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    assetsInlineLimit: 0,
  },
  server: { port: 5177, host: true },
});
