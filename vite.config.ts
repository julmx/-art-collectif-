import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({ root: 'web', build: { outDir: '../dist', emptyOutDir: true, rollupOptions:{input:{main:resolve('web/index.html'),admin:resolve('web/admin.html')}} }, server: { proxy: { '/api': 'http://127.0.0.1:3000', '/socket.io': { target:'http://127.0.0.1:3000', ws:true } } } });
