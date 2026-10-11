import ts from "typescript";
import assets from "./compiler-assets.js";

/** Validated source and executable code; compilation never evaluates the module. */
export interface CompiledHook { source: string; javascript: string }
const cache = new Map<string, CompiledHook>();
const options: ts.CompilerOptions = {
  strict: true, noLib: true, types: [], target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.CommonJS, noEmitOnError: true, skipLibCheck: true,
  ignoreDeprecations: "6.0",
};
const libraries = new Map(Object.entries(assets).map(([name, text]) => [name, ts.createSourceFile(name, text, options.target!)]));

export function compileHook(path: string, source: string): CompiledHook {
  const cached = cache.get(source);
  if (cached) return cached;
  if (source.length > 32_768) throw new Error(`${path}: hook source exceeds 32 KiB`);
  if (/@ts-(?:ignore|expect-error|nocheck)/.test(source)) throw new Error(`${path}: TypeScript diagnostic suppression is unavailable in hooks`);
  const file = ts.createSourceFile("/hook.ts", source, options.target!, true);
  function inspect(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)
      || ts.isImportTypeNode(node) || node.kind === ts.SyntaxKind.ImportKeyword) throw new Error(`${path}: hooks cannot import modules`);
    ts.forEachChild(node, inspect);
  }
  inspect(file);
  const files = new Map(libraries);
  files.set("/hook.ts", file);
  files.set("/entry.ts", ts.createSourceFile("/entry.ts", 'import hook from "./hook"; const checked: Hook = hook;', options.target!));
  let javascript = "";
  const host: ts.CompilerHost = {
    getSourceFile: name => files.get(name), getDefaultLibFileName: () => "/lib.es2020.d.ts",
    writeFile: (name, text) => { if (name === "/hook.js") javascript = text; },
    getCurrentDirectory: () => "/", getDirectories: () => [], fileExists: name => files.has(name),
    readFile: name => files.get(name)?.text, getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
    resolveModuleNames: names => names.map(name => name === "./hook" ? { resolvedFileName: "/hook.ts", extension: ts.Extension.Ts } : undefined),
  };
  const program = ts.createProgram([...files.keys()], options, host);
  const errors = ts.getPreEmitDiagnostics(program);
  if (errors.length) throw new Error(errors.slice(0, 8).map(error => {
    const at = error.file?.getLineAndCharacterOfPosition(error.start ?? 0);
    return `${path}${at ? `:${at.line + 1}:${at.character + 1}` : ""}: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`;
  }).join("\n"));
  program.emit();
  if (!javascript) throw new Error(`${path}: hook emitted no JavaScript`);
  const compiled = { source, javascript };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(source, compiled);
  return compiled;
}
