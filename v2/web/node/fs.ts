/**
 * node:fs in the page's bundles (browser-design §5): nothing, since nothing in the page has a file
 * system. Only the model client's process-global mode asks for it (ai/llm/openrouter.ts: the dev key
 * file, the call log and the cost ledger, the prototype's), which the page host never reaches: each
 * call it makes has a call context, with its key and its logs. Each name throws, saying so, if it is.
 */

const noFiles = (name: string) => (): never => {
  throw new Error(`${name}: there's no file system in the page (the model client's process-global mode is the prototype's)`);
};

export const appendFileSync = noFiles("appendFileSync");
export const mkdirSync = noFiles("mkdirSync");
export const readFileSync = noFiles("readFileSync");
