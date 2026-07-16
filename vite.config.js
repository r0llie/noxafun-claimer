import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "sites-worker-entry",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "server/index.js",
          source: `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/noxa/")) {
      const upstream = new URL(url.pathname.replace("/api/noxa/", "/catalog/rh/"), "https://fun.noxa.eth.link");
      return fetch(upstream, { headers: { accept: "*/*", referer: "https://fun.noxa.eth.link/" } });
    }
    return env.ASSETS.fetch(request);
  }
};`
        });
      }
    }
  ],
  server: {
    proxy: {
      "/api/noxa": {
        target: "https://fun.noxa.eth.link",
        changeOrigin: true,
        headers: {
          origin: "https://fun.noxa.eth.link",
          referer: "https://fun.noxa.eth.link/"
        },
        rewrite: (path) => path.replace(/^\/api\/noxa/, "/catalog/rh")
      }
    }
  }
});
