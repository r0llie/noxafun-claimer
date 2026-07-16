import { defineConfig } from "vite";

export default defineConfig({
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
