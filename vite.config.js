import { defineConfig } from 'vite'

// opendata.dwd.de does not send Access-Control-Allow-Origin, so the browser
// cannot fetch it directly - both `vite dev` and `vite preview` proxy /dwd
// to it locally. A real (non-Vite) production deployment has no such proxy
// built in: it needs its own reverse proxy (e.g. nginx `location /dwd { proxy_pass
// https://opendata.dwd.de; }`, or a small serverless function) forwarding
// requests the same way, with VITE_DWD_BASE_URL pointed at it. See README.md.
const dwdProxy = {
  '/dwd': {
    target: 'https://opendata.dwd.de',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/dwd/, ''),
  },
}

export default defineConfig({
  server: {
    proxy: dwdProxy,
  },
  preview: {
    proxy: dwdProxy,
  },
})
