import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SyntaxKind, type Node } from "typescript/unstable/ast";
import {
  isCallExpression, isElementAccessExpression, isExportDeclaration, isExternalModuleReference, isIdentifier, isImportDeclaration,
  isImportEqualsDeclaration, isImportExpression, isImportTypeNode, isJSDocImportTag, isJsxElement, isJsxFragment, isJsxSelfClosingElement,
  isLiteralTypeNode, isMetaProperty, isModuleDeclaration, isNoSubstitutionTemplateLiteral, isPropertyAccessExpression, isStringLiteral,
} from "typescript/unstable/ast/is";
import { API } from "typescript/unstable/sync";

/**
 * The one rule (README.md): v2/ai imports only node: built-ins, its own files, v2/shared (the
 * protocol, the scene graph and the world it shares with the simulation) and v2/vendor (the rules
 * engine, which it runs to make the build cards it offers), so the prototype and v2 can share it. Never the prototype: the prototype reaches in (src/llm, src/lore,
 * src/runtime/brief.ts), nothing here reaches out, and the prototype's type check wouldn't notice
 * if something did. v2/shared keeps to itself in turn (v2/shared/imports.test.ts).
 *
 * The files are read with the TypeScript compiler's parser, because patterns over the text kept
 * missing imports the language allows (a comment inside one, a name spelled with escapes). The
 * parser is TypeScript 7's, a process of its own that the package's typescript/unstable API drives,
 * and it's the one thing here from outside v2/ai and v2/shared: this file may import it, and nothing
 * else may.
 * That API may change with TypeScript's version; the test checks the parser found its own imports.
 */

const ROOT = import.meta.dirname;
const SELF = import.meta.filename;
const SHARED = resolve(ROOT, "..", "shared");
const VENDOR = resolve(ROOT, "..", "vendor");

/**
 * What in the code under root reaches outside it, a line each ("file:line: what"), with every
 * module name the code gives. A module is named by an import or export with a from, an import for
 * its side effects, import x = require(), import() or require() (import.defer(), module.require()
 * too), a type's import(), a JS file's JSDoc types and import tags (in a TS file JSDoc is only a
 * comment), declare module and /// <reference path>. Each name must be a node: built-in, or a file
 * of root's, or of a folder in `also`, by a relative name. Never allowed, since where they lead can't be read here: an import()
 * or require() of anything but a string written out (a template without ${} is one), a require
 * that isn't called, createRequire, /// <reference types> and JSX, which imports a runtime the file
 * doesn't name. A file the parser can't read is reported too, and so is one that's only under root
 * by a symlink out of it; a file is read once, however many links lead to it. Exported for a probe
 * of planted files.
 */
export function scan(root: string, also: string[] = []) {
  const names: string[] = [];
  const outside: string[] = [];
  const files: string[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(root, { recursive: true, encoding: "utf8" }).filter(f => /\.[cm]?[jt]sx?$/.test(f) && !f.split(sep).includes("node_modules")).sort()) {
    const path = real(join(root, file));
    if (!inside(root, path)) outside.push(`${file}: a link out, to ${path}`);
    else if (!seen.has(path)) {
      seen.add(path);
      files.push(file);
    }
  }
  // The parser reads these files and no others (no lib, nothing they import), by a tsconfig only it sees.
  const config = join(root, "imports.test.tsconfig.json");
  const options = JSON.stringify({ compilerOptions: { allowJs: true, noResolve: true, noLib: true, types: [], jsx: "preserve" }, files: files.map(f => join(root, f)) });
  const api = new API({ cwd: root, fs: { readFile: f => (f === config ? options : undefined), fileExists: f => (f === config ? true : undefined) } });
  try {
    const program = api.updateSnapshot({ openProjects: [config] }).getProject(config)?.program;
    for (const file of files) {
      const path = join(root, file);
      const js = /\.[cm]?jsx?$/.test(file);
      const source = program?.getSourceFile(path);
      if (!program || !source) {
        outside.push(`${file}: not read by the parser`);
        continue;
      }
      const at = (pos: number, what: string) => outside.push(`${file}:${source.getLineAndCharacterOfPosition(pos).line + 1}: ${what}`);
      const shown = (node: Node) => node.getText(source).replace(/\s+/g, " ").slice(0, 100);
      const named = (node: Node, name: string) => {
        names.push(`${file}: ${name}`);
        if (!allowed([root, ...also], path, name) && !(path === SELF && name.startsWith("typescript/"))) at(node.getStart(source), name);
      };
      /** The name in a module's place, if it's a string written out; anything else is reported as it's written. */
      const written = (name: Node | undefined, from: Node) =>
        name && (isStringLiteral(name) || isNoSubstitutionTemplateLiteral(name)) ? named(name, name.text) : at(from.getStart(source), `${shown(from)}: not a name written out`);
      for (const d of program.getSyntacticDiagnostics(path)) at(d.pos, `doesn't parse: ${d.text}`);
      for (const ref of source.referencedFiles) {
        names.push(`${file}: ${ref.fileName}`);
        if (!inside(root, resolve(dirname(path), ref.fileName))) at(ref.pos, `/// <reference path="${ref.fileName}" />`);
      }
      for (const ref of source.typeReferenceDirectives) at(ref.pos, `/// <reference types="${ref.fileName}" />`);
      const visit = (node: Node): void => {
        if (isImportDeclaration(node) || isExportDeclaration(node) || isJSDocImportTag(node)) {
          if (node.moduleSpecifier) written(node.moduleSpecifier, node);
        } else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) written(node.moduleReference.expression, node);
        else if (isImportTypeNode(node)) written(isLiteralTypeNode(node.argument) ? node.argument.literal : node.argument, node);
        else if (isModuleDeclaration(node) && isStringLiteral(node.name)) named(node.name, node.name.text);
        else if (isCallExpression(node) && loads(node.expression)) written(node.arguments[0], node);
        else if (isJsxElement(node) || isJsxSelfClosingElement(node) || isJsxFragment(node)) at(node.getStart(source), "JSX, which imports its runtime");
        const name = read(node);
        if (name === "createRequire") at(node.getStart(source), "createRequire");
        if (name === "require" && !called(node)) at(node.getStart(source), `${shown(node.parent)}: a require that isn't called`);
        if (js) for (const doc of node.jsDoc ?? []) visit(doc);
        node.forEachChild(visit);
      };
      visit(source);
    }
  } finally {
    api.close();
  }
  return { files, names, outside: [...new Set(outside)] };
}

/** The name a node reads: an identifier, a property (x.name) or an index by a string (x["name"]). */
const read = (node: Node) => {
  if (isIdentifier(node)) return node.text;
  if (isPropertyAccessExpression(node)) return node.name.text;
  const index = isElementAccessExpression(node) ? node.argumentExpression : undefined;
  return index && (isStringLiteral(index) || isNoSubstitutionTemplateLiteral(index)) ? index.text : undefined;
};

/** A call that loads a module: import(), import.defer() and the like, or require(), x.require() or x["require"](). */
const loads = (callee: Node) =>
  isImportExpression(callee) || (isMetaProperty(callee) && callee.keywordToken === SyntaxKind.ImportKeyword) || read(callee) === "require";

/** Whether a require is called, or only names something: the property in x.require (the access is judged), or a declaration or key. */
const called = (node: Node) => {
  const parent = node.parent;
  return (isCallExpression(parent) && parent.expression === node) || (isPropertyAccessExpression(parent) && parent.name === node) || (isIdentifier(node) && (parent as { name?: Node }).name === node);
};

/** A node: built-in, or a file of one of roots' by a relative name: read as node's loader reads it (a URL, where %2e%2e is ..) and as a path, both land in that root. */
function allowed(roots: string[], from: string, name: string) {
  if (name.startsWith("node:")) return isBuiltin(name);
  if (!/^\.\.?(\/|$)/.test(name)) return false;
  try {
    const asPath = resolve(dirname(from), name), asUrl = fileURLToPath(new URL(name, pathToFileURL(from)));
    return roots.some(root => inside(root, asPath) && inside(root, asUrl));
  } catch {
    return false; // a name node can't read as a file, like one with an encoded /
  }
}

/** Whether a path is in root, its symlinks followed, and not in a node_modules there. */
const inside = (root: string, path: string) => {
  const parts = relative(real(root), real(path)).split(sep);
  return parts[0] !== "" && parts[0] !== ".." && !isAbsolute(parts.join(sep)) && !parts.includes("node_modules");
};

/** A path with its symlinks followed, as far as it exists. */
const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return dirname(path) === path ? path : join(real(dirname(path)), basename(path));
  }
};

test("v2/ai imports nothing but node:, itself, v2/shared and v2/vendor", () => {
  const { files, names, outside } = scan(ROOT, [SHARED, VENDOR]);
  assert.ok(files.length > 10, "the scan found the folder's code");
  assert.ok(names.includes("imports.test.ts: node:test"), "the parser found this file's own imports");
  assert.deepEqual(outside, []);
});
