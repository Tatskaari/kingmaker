# Document-authored conversation hooks

Conversation transitions run TypeScript authored through the ordinary document
editing tools. Quest lifecycle hooks are outside this first version. Start a
fresh game to use the migrated hooks; old saves are not migrated.

## Author and bind

Create `Hooks/<name>.ts`, where the name contains lowercase letters, digits and
hyphens and starts with a letter. The source has a default async function:

```ts
export default async function run(services: HookServices): Promise<TransitionResult> {
  const quest = services.quests.read("assembly_programme");
  await services.quests.setActive(quest.id, true, quest.revision);
  return { status: "accepted", message: "Programme activated." };
}
```

The public types are available without imports. Read the
[hook authoring reference](hooks/index.md), then follow the relevant service and
type links. Add `#### Run: <name>.ts` to a conversation transition to bind it.
Creating or binding a hook does not execute it; evaluation runs it before the
transition advances. A rejected result supplies a reason and leaves the current
node unchanged.

Use `create_document`, `read_document`, `replace_document`, `insert_document` and
`delete_document` for source, just as for Markdown. Reads preserve the raw
TypeScript; source is GM-only. Create source before adding its reference, or
publish both together in a document-service batch.

## Validation and changes

The existing unpublished-document pipeline type-checks sources, validates their
entrypoint and import policy, emits JavaScript and resolves every conversation
`Run` reference before publishing documents and definitions. Errors reject the
write with source diagnostics. An invalid source, missing reference or deletion
of a referenced hook cannot replace the last valid version. Remove references
before deleting a source, or perform both changes in one batch.

Hook-only edits update dependent conversation revisions. Pending decisions are
discarded and sessions refresh their bindings. Old bindings check their source
identity before service effects and reject after replacement. Saves contain
source documents; loading rebuilds compiled hooks and bindings without executing
them. Generated reference pages come from the running build.

## Runtime and effects

TypeScript's browser compiler API checks against the same public declarations
used to generate the reference. QuickJS/WASM executes each hook in a fresh VM,
with a 16 MiB memory limit, 256 KiB stack limit, one-second execution deadline and
64 service-call limit. Imports, browser globals and application internals are
unavailable. Source is limited to 32 KiB.

Hooks receive explicit `quests` and `map` services. Reads expose projected data;
fixture updates run synchronous draft callbacks inside the VM and publish through
the authoritative host service. Await every write. Fixture callbacks cannot call
other services or return promises. Cancellation and replaced bindings prevent
subsequent guarded effects.

Each service write is a separate operation. A later exception, cancellation or
rejected result does **not** roll back effects already published. Write retry-safe
hooks and do not assume exactly-once execution. Character speech remains a
separate tool-free model call.

Fresh web and CLI worlds load the three shipped sources under `content/hooks/`:
programme activation, the pillow lead and Holt's cart-smashing permission. They
use the same compilation, binding and execution path as agent-authored sources.

## Checks

`tests/hook-source.test.ts`, `tests/hook-runtime.test.ts` and
`tests/hook-bindings.test.ts` cover source validation, bounded execution,
publication, resume and binding invalidation. See
[reference generation](hook-api-documentation.md) for the generated docs and
read-only enforcement.
