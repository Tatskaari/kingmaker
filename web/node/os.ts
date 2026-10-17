/**
 * node:os in the page's bundles (browser-design §5): nothing. Only the model client's process-global
 * mode asks for it (ai/llm/openrouter.ts: where the dev key file is), which the page host never
 * reaches (its calls carry their key). It throws, saying so, if it is.
 */

export const homedir = (): never => {
  throw new Error("homedir: there's no home folder in the page (the model client's process-global mode is the prototype's)");
};
