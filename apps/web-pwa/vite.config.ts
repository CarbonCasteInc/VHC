import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true
  },
  define: {
    'process.env': {},
    global: 'window'
  },
  worker: {
    format: 'es'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@vh/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@vh/gun-client': path.resolve(__dirname, '../../packages/gun-client/src'),
      '@vh/types': path.resolve(__dirname, '../../packages/types/src'),
      '@vh/ai-engine': path.resolve(__dirname, '../../packages/ai-engine/src'),
      '@vh/crypto': path.resolve(__dirname, '../../packages/crypto/src'),
      '@vh/contracts': path.resolve(__dirname, '../../packages/contracts/typechain-types')
    }
  }
});
