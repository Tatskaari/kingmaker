import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "apps/web",
  publicDir: "public",
  build: {
    outDir: `${repositoryRoot}/dist/web`,
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4317",
      "/__dev": "http://127.0.0.1:4317",
    },
  },
});
