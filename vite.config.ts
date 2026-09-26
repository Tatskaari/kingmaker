import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "apps/web",
  publicDir: "public",
  base: "./",
  build: {
    outDir: `${repositoryRoot}/dist/web`,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        game: `${repositoryRoot}/apps/web/index.html`,
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
