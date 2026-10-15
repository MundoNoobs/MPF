import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // json-server reescribe db.json con cada cambio; evita que Vite recargue la página
      ignored: ['**/db.json'],
    },
  },
})
