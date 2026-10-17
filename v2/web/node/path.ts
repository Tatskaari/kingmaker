/**
 * node:path in the page's bundles (browser-design §5): nothing. Only the model client's
 * process-global mode asks for it (ai/llm/openrouter.ts: the dev key file's path, the call log's and
 * the cost ledger's folders), which the page host never reaches; the docs service has its own posix
 * paths (ai/docs/paths.ts). Each name throws, saying so, if it is.
 */

const noPaths = (name: string) => (): never => {
  throw new Error(`${name}: there are no file paths in the page (the model client's process-global mode is the prototype's)`);
};

export const dirname = noPaths("dirname");
export const join = noPaths("join");
