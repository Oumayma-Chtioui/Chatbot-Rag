import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    historyApiFallback: true,  // ← add this
    proxy: {
      '/widgets': 'http://localhost:8000',  // ← proxy API requests to FastAPI backend
    },
  }
})
