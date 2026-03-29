import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/dwd': {
        target: 'https://opendata.dwd.de',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dwd/, ''),
      },
    },
  },
})