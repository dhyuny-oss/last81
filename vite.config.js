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
        main: resolve(__dirname, 'index.html'),   // 185. 베타(/beta) 페이지는 지웠습니다 — 재무 데이터 수집은 알파가 그대로 씀
      },
    },
  },
})
