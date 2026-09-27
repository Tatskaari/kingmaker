import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));
const devKeyFlag = "KINGMAKER_USE_DEV_OPENROUTER_KEY";
const devKeyModule = "virtual:kingmaker-dev-openrouter-key";

function developmentOpenRouterKey(command: string): string {
  if (command !== "serve" || process.env[devKeyFlag] !== "1") return "";

  const secretPath = `${homedir()}/secrets/kingmaker-dev-openrouter.txt`;
  const apiKey = readFileSync(secretPath, "utf8").trim();
  if (!apiKey) throw new Error(`${devKeyFlag}=1 but ${secretPath} is empty`);
  return apiKey;
}

export default defineConfig(({ command }) => ({
  plugins: [{
    name: "kingmaker-dev-openrouter-key",
    resolveId(id) { if (id === devKeyModule) return `\0${devKeyModule}`; },
    load(id) { if (id === `\0${devKeyModule}`) return `export default ${JSON.stringify(developmentOpenRouterKey(command))};`; },
  }],
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
}));
