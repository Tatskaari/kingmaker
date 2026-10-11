// The asm.js build runs unchanged in Node and the browser worker without
// locating a separate .wasm asset. It exposes the same API as the main entry.
declare module "sql.js/dist/sql-asm.js" {
  import initSqlJs from "sql.js";
  export default initSqlJs;
}
