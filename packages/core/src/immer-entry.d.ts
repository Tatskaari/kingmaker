// Use boardgame.io's CommonJS entry in both executors. Immer 9's ESM and
// CommonJS development builds use incompatible internal draft field names.
// The CommonJS subpath exposes the same public API but has no declaration file.
declare module "immer/dist/index.js" {
  export { Immer, isDraft, original } from "immer";
}
