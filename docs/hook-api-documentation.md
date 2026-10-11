# Generated hook service documentation

The public contract is `packages/hooks/src/services.ts`. TypeDoc and its Markdown
plugin generate the committed [reference](hooks/index.md). This layer implements
generation and drift checks; document loading and execution follow in the stack.

## Source of truth

Define a common hook-services interface as the public entrypoint for the services
actually exposed to the bounded runtime. Reuse existing service types where their
contracts are unchanged. Any adapter must describe its actual runtime signatures,
including asynchronous proxy calls; do not document internal methods that hooks
cannot call. Use these declarations both for hook type-checking and API generation.

The current application hooks use `quests`, `map` and `scenario`. The initial
surface must cover quest reads/activation/transitions, fixture discovery and
fixture action edits. Selecting the exact exposed methods and resolving the live
world read/draft callback boundary precedes generating the authoritative reference.
The first implementation need not expose every method on every internal service.

Add `/** ... */` documentation comments on exposed interfaces, methods and public
data types. Include a short purpose, parameters, results, errors, revision rules,
mutation ownership, cancellation behaviour where supported, and examples. Explain
that individual service writes do not make a whole hook transactional. Describe
which inputs are actor IDs, character IDs, document paths or quest IDs.

Use `@param`, `@returns`, `@throws`, `@remarks`, `@example` and `{@link ...}` where
appropriate. Link complex input/output types so the reader can progressively open
their definitions. Keep example hooks as compilable fixtures or extract and
type-check them against the same declarations; avoid separately maintained copies.

## Generator selection

Use [TypeDoc](https://typedoc.org/documents/Doc_Comments.html) with
[typedoc-plugin-markdown](https://typedoc-plugin-markdown.org/docs/quick-start).
TypeDoc associates TypeScript declarations with TSDoc/JSDoc-style comments; the
plugin provides Markdown output. This covers signatures and linked types as well
as comment parsing, without a custom documentation parser or Markdown renderer.

Configure a public API entrypoint rather than scanning all implementation exports.
Use the plugin's [file options](https://typedoc-plugin-markdown.org/docs/options/file)
to produce an index and separate reference pages, and its
[output options](https://typedoc-plugin-markdown.org/docs/options/output) to select
the destination. Prefer standard configuration over a custom theme.

The workspace uses the official side-by-side compiler setup: `@typescript/native`
provides TypeScript 7.0.2's `tsc`, while `typescript` aliases Microsoft's
`@typescript/typescript6` 6.0.2 compatibility package for the compiler API and
TypeDoc 0.28.20 / typedoc-plugin-markdown 4.13.1. Both versions are pinned.
TypeScript 7 WASM (`tsgo-wasm`) was investigated: it distributes a binary and Node
CLI launcher, without an embeddable browser compiler API. A browser adapter is
outside this PoC. See Microsoft's [side-by-side recommendation](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

## Committed output and progressive reading

Commit the generated reference under `docs/hooks/`, including `index.md`, service
pages and the public types needed to understand method inputs and results. Mark
output as generated and identify its source entrypoint and regeneration command.
The index contains the hook entrypoint contract, short service descriptions and
links; it must not inline the entire API. Method pages contain full signatures,
semantics and examples. Keep explanatory design documents outside generated output.

Include deterministic page summaries and GM-only metadata suitable for document
loading. Derive summaries from documented purposes, not invented capabilities.
Use stable relative links that work in the repository and resolve correctly when
loaded into the document graph. Avoid timestamps, absolute checkout paths and
changing commit hashes in output so an unrelated commit cannot cause drift.

Load the same generated Markdown into the docs service at `docs/hooks/...`.
Ordinary reads and read-only queries should discover it, including summaries and
links. Bundle it for browser, CLI and eval world construction; verify it is also
available after save/resume. Application-owned reference content and protection
must come from the running build, not agent-editable saved metadata. No old-save
migration is required for incompatible representation changes.

Update the common agent review guidance with a link to `docs/hooks/index.md` and
an instruction to open the relevant service/type pages before writing a hook.
Do not inject the whole reference into every review or expose GM-only reference
links through a character's permitted knowledge graph.

## Read-only document enforcement

Read-only is an authority policy enforced by the document service. A document's
body or editable frontmatter cannot remove it. Protect the application-owned
reference namespace against creation, replacement, insertion, deletion and batch
commit, including currently absent paths that could shadow generated references.
Use the same canonical path rules as document identity; reject alias/traversal
spellings that would bypass protection. Keep unrelated gameplay documents writable.

Validate permissions before publication. A batch containing a protected write
must publish no document or intent changes. Return an actionable tool error naming
the protected path. Internal loading of application-owned reference pages is not
an agent document write. Reads, query discovery and graph links remain supported.

## Moon tasks and drift checks

Implemented tasks:

- `workspace:hooksDocsGenerate`: run the pinned generator with the public API
  entrypoint and configuration, writing the committed `docs/hooks/` output.
- `workspace:hooksDocsCheck`: generate to a temporary directory and compare the
  complete file set and contents against committed output. Fail on missing,
  changed or obsolete pages and show the regeneration command. Never fix tracked
  files as a side effect of the check.

Track service declarations/comments, referenced public types, generator config,
templates or generation script, committed docs and package/lockfile changes as
Moon inputs. Wire the check into affected CI checks so stale output is detected
when either source or generated files change. Verify the existing `moon ci`
selection runs it; adding a task without CI wiring is insufficient.

## Implementation QA

- Generate twice from unchanged inputs; expect byte-identical output and no diff.
- Change a method/comment or delete a service; expect the check to report drift.
- Compile documented examples; reject examples using unavailable service methods.
- Read the index and follow service/type links through the real docs service.
- Attempt every write operation against a protected reference, including a batch
  with a writable document and intent; expect rejection with no partial writes.
- Attempt frontmatter changes, namespace shadowing and path aliases; protection
  must remain effective. Confirm ordinary gameplay document edits still work.
- Load a fresh game and resume a current-format save; expect the current build's
  reference pages and the same protection, without executing hooks.
- Inspect common review context; expect an index link, not the complete reference.

These are implementation acceptance criteria, not tests run by the docs stack.
