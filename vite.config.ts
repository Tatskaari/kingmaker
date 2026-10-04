import { defineConfig, type Plugin } from "vite";
import { readPromptCatalog } from "./packages/prompts/src/catalog.js";
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

function markdownPrompts(): Plugin {
  return {
    name: "kingmaker-markdown-prompts",
    load(id) {
      if (id !== `${repositoryRoot}packages/prompts/src/catalog.ts`) return;
      const directory = new URL("./lore/gm_prompts/", import.meta.url);
      const catalog = readPromptCatalog(directory);
      for (const name of Object.keys(catalog)) this.addWatchFile(fileURLToPath(new URL(`${name}.md`, directory)));
      return `export default ${JSON.stringify(catalog)};`;
    },
  };
}

export default defineConfig(({ command }) => ({
  worker: { plugins: () => [markdownPrompts()] },
  plugins: [markdownPrompts(), {
    name: "kingmaker-dev-openrouter-key",
    resolveId(id) { if (id === devKeyModule) return `\0${devKeyModule}`; },
    load(id) { if (id === `\0${devKeyModule}`) return `export default ${JSON.stringify(developmentOpenRouterKey(command))};`; },
  }],
  // Markdown entity decoding must work in workers, where there is no document.
  resolve: { alias: { "decode-named-character-reference": `${repositoryRoot}/node_modules/decode-named-character-reference/index.js` } },
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
    strictPort: false,
  },
}));
