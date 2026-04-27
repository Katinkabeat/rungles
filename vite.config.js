import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/rungles/',
  server: {
    port: 5183,
    strictPort: true,
  },
})
