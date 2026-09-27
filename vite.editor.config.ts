import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "apps/editor",
  publicDir: "../web/public",
  base: "./",
  build: {
    outDir: `${repositoryRoot}/dist/editor`,
    emptyOutDir: true,
    rollupOptions: { input: { editor: `${repositoryRoot}/apps/editor/index.html` } },
  },
});
