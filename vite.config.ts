import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // relative asset paths: the build runs from any static host or sub-path (e.g. GitHub Pages)
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
})
