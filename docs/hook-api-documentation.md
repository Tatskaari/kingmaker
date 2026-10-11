# Generated hook service documentation

`packages/hooks/src/services.ts` is the public API contract for runtime compilation
and documentation. Its TSDoc/JSDoc-style comments explain the exposed services,
parameters, return values and effect semantics. The committed
[reference](hooks/index.md) is generated with
[TypeDoc](https://typedoc.org/documents/Doc_Comments.html) and
[typedoc-plugin-markdown](https://typedoc-plugin-markdown.org/docs/quick-start).

## Update the reference

Edit the public declarations/comments or `scripts/hooks/README.md`, then run:

```sh
proto run moon -- run workspace:hooksDocsGenerate
proto run moon -- run workspace:hooksDocsCheck
```

Commit the generated `docs/hooks/` files. The check regenerates into a temporary
directory and compares the complete file set and contents, detecting changed,
missing and obsolete pages without changing tracked files. It is a dependency of
`workspace:check`; Moon inputs include the API, generator, template, output and
package lock. Output has stable summaries and GM-only metadata, without timestamps
or checkout paths.

## Compiler choice

The workspace uses Microsoft's side-by-side compiler setup: `@typescript/native`
provides TypeScript 7.0.2's `tsc`, while `typescript` aliases the pinned
`@typescript/typescript6` compatibility package for the browser compiler API and
TypeDoc. TypeDoc 0.28.20 and typedoc-plugin-markdown 4.13.1 are pinned too.

TypeScript 7 WASM (`tsgo-wasm`) was investigated, but its binary and Node launcher
do not provide the embeddable browser compiler API this integration needs. This
PoC uses the compatibility compiler for runtime compilation and documentation.
See Microsoft's [side-by-side recommendation](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

## Agent discovery and protection

World construction mounts the current build's reference at `docs/hooks/` in the
document service, including after save/load. Node loads the committed Markdown;
Vite bundles the same catalog for the browser and its workers. The common review
guidance links `docs/hooks/index.md` and asks authors to read relevant service and
type pages progressively before writing a hook.

The reference namespace is host-owned and read-only. Document creation,
replacement, insertion, deletion and batch writes reject protected paths,
including absent paths. Editable frontmatter cannot remove protection. A batch
containing a protected write publishes no changes. Ordinary reads, queries and
links still work; gameplay source under `Hooks/` remains writable.

`tests/read-only-documents.test.ts` and `tests/hook-reference.test.ts` cover these
policies and reference discovery. See [document-authored hooks](document-hooks.md)
for source editing, graph binding and runtime behavior.
