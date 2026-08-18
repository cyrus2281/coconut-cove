import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// /components is the clean URL for the creature debug viewer
// (components.html); rewrite it in dev and preview, and emit the page as a
// second rollup input so the built site has it too.
function componentsRoute() {
  const rewrite = (req, _res, next) => {
    if (req.url === '/components' || req.url === '/components/'
      || req.url.startsWith('/components?')) {
      req.url = '/components.html';
    }
    next();
  };
  return {
    name: 'components-route',
    configureServer(server) { server.middlewares.use(rewrite); },
    configurePreviewServer(server) { server.middlewares.use(rewrite); },
  };
}

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [componentsRoute()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        components: fileURLToPath(new URL('./components.html', import.meta.url)),
      },
    },
  },
});
