import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    target: 'es2020',
    rollupOptions: {
      input: {
        // 알파 (기존 — 변경 없음)
        main: resolve(__dirname, 'index.html'),
        // 베타 (신규)
        beta: resolve(__dirname, 'beta.html'),
      },
    },
  },
})
