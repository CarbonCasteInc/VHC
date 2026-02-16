import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 2048,
    strictPort: true,
    allowedHosts: [
      '100.75.18.26',
      'ccibootstrap.tail6cc9b5.ts.net',
      '.tail6cc9b5.ts.net'
    ],
    proxy: {
      '/gun': {
        target: 'http://127.0.0.1:7777',
        changeOrigin: true,
        ws: true,
        secure: false
      }
    }
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
      '@vh/data-model': path.resolve(__dirname, '../../packages/data-model/src'),
      '@vh/contracts': path.resolve(__dirname, '../../packages/contracts/typechain-types'),
      '@vh/identity-vault': path.resolve(__dirname, '../../packages/identity-vault/src')
    }
  }
});
