import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: [
      '5173-itnjtda6any43wy9bvob4-76b5ad27.sg1.manus.computer',
      '5174-itnjtda6any43wy9bvob4-76b5ad27.sg1.manus.computer',
      '.manus.computer',
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
