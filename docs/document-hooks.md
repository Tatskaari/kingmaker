# Document-authored conversation hooks

Status: agreed direction for implementation; this document does not add executable
hooks. Conversation transitions are the first integration. Quest lifecycle hooks
can reuse the infrastructure later, but are outside the first version.

## Existing integration

Conversation Markdown declares `#### Run: <name>.ts` on a transition. The parser
records that name separately from the quest graph. The web host registers three
application functions in `apps/web/src/world-runtime.ts`; the CLI registers only
the Aldren demo. `ConversationTreeSession` accepts a registry of
`(signal: AbortSignal) => Promise<string>` functions and rejects unknown names.

The existing hooks activate Assembly Programme, record Holt's pillow lead, and
add or legalise the cart's smash actions. They use `quests`, `map` and `scenario`
services. The shared fixture setup avoids duplicate actions and preserves prior
permission. See [conversation trees](conversation-trees.md) for current behaviour.

The incoming [definition-validation PR #597](https://github.com/Tatskaari/kingmaker/pull/597)
adds `prepareQuestDefinitions` to document publication. It compiles unpublished
quest/dialogue drafts and preserves progress, rejecting malformed graphs and
removal of the current node. [Session-refresh PR #598](https://github.com/Tatskaari/kingmaker/pull/598)
refreshes consumers and rejects stale decisions. These are implementation
dependencies, not features introduced by this documentation PR.

## One document editing and validation path

Agents create and edit `.ts` hook source with the existing document tools:
`create_document`, `read_document`, `replace_document`, `insert_document` and
`delete_document`. Do not introduce separate hook-editing tools. The service's
batch `commit` must use the same validation as individual writes.

Extend document handling to preserve TypeScript source exactly instead of parsing
it as Markdown frontmatter/body. Keep existing SHA conflict checks and line-edit
semantics. Source and its host-owned GM access metadata must survive save/load;
source text cannot grant itself character visibility. The precise representation
in the document schema is an implementation decision, not an existing format.

Add hook compilation to the existing unpublished-document validation pipeline:

1. Build the draft containing all requested document changes.
2. Type-check changed hook sources against the common hook-services declarations
   and permitted language libraries. Check the entrypoint and import policy.
3. Compile valid sources to JavaScript and prepare available hook registrations.
4. During dialogue graph preparation, resolve declared hook references against
   that draft registry and prepare bindings for the graph.
5. Publish documents, definitions and prepared bindings only after all validation
   succeeds. Discard prepared artifacts on failure; compilation never runs hooks.

A valid unreferenced source is an available hook. Adding a tree reference binds
it; neither operation executes it. A batch can create source and its reference
together. Individual calls can create the source before editing the tree.
Use a canonical document-path resolution rule and reject ambiguous names; exact
folder naming and the extension of today's bare-name `Run` syntax remain to be
specified during implementation.

Compilation failures should use the existing `document_validation` tool response,
with source path, line/column and actionable diagnostics. Failed compilation or
binding must preserve the previous document SHA, graph, progress and bindings.

## Edits, dependencies and loading

Hook edits and deletions pass through those same validators. Recheck referring
graphs when a hook changes; a reference to deleted or invalid source rejects the
write. Removing the reference first permits deletion. Do not add a separate
editing lifecycle or allow a stale compiled hook to hide invalid source.

Cache compiled artifacts by source and API/compiler version. A hook-only edit must
invalidate affected pending dialogue decisions through the existing definition
revision mechanism, even if the dialogue Markdown itself did not change. Recheck
the captured definition/binding before executing effects, as session refresh does
for graph changes. Define ordering for edits during an already-running hook;
do not imply revision checks undo effects already published.

Save source documents, not closures. Fresh construction and save loading rebuild
the registry and bindings through the same validators. Require a fresh game for
incompatible save/schema changes; do not implement saved-game migrations.

## Service binding and execution

Use a common typed services object for authored hooks. Reuse existing service
names and contracts where they fit the bounded runtime. Bind implementations in
the host; do not expose arbitrary application imports or a writable world object.
The same exposed declarations drive compilation and generated API documentation.

The runtime must bound execution and support cancellation. TypeScript checking
and JavaScript generation do not themselves isolate code or bound its execution.
Runtime/compiler selection is still open. Reads must not permit mutation of live
state, and all effects go through the owning authoritative services.

Two existing contracts need explicit treatment: `scenario.read()` exposes live
world state to trusted host code, and `map.updateFixture(id, callback)` accepts a
synchronous draft callback. Functions cannot simply cross a worker boundary.
Resolve their bounded-runtime contracts before implementation; do not silently
replace current-state edits with detached whole-world snapshots or world cloning.

Keep the executor's hook-before-transition ordering. Existing service writes are
separate operations, not an atomic transaction across the hook and graph advance.
Document partial failure, require retry-safe effects, and test failure after a
successful first effect. Do not promise rollback or exactly-once execution.
Character response models remain tool-free with reasoning effort `none`.

## Implementation acceptance criteria

- Create a valid hook through document tools and bind it through a dialogue edit.
- Reject syntax/type errors, unsupported API calls, invalid entrypoints/imports,
  unresolved references and deletion of referenced hooks before publication.
- Verify failed batches preserve unrelated documents and live quest progress.
- Verify hook-only edits invalidate pending decisions and refresh later execution.
- Verify source reads/edits preserve TypeScript text and stale SHAs are rejected.
- Verify save/resume rebuilds bindings without executing hooks during loading.
- Exercise bounded execution, cancellation and retry after partial effects.
- Migrate the three existing hooks through the same path and preserve their
  observable quest activation, lead progression and cart-permission behaviour.

These are proposed implementation checks, not validation performed by this docs
change. See [generated hook service documentation](hook-api-documentation.md) for
API reference generation, read-only delivery and Moon drift checks.
