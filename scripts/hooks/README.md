# Hook services

Read this index, then open the service and data-type pages needed for your hook.
This reference is generated from the same interfaces used by hook validation.

- [Quest service](interfaces/HookQuestService.md): inspect, activate and advance quests.
- [Map service](interfaces/HookMapService.md): read fixtures and edit interaction actions.
- [Hook signature](type-aliases/Hook.md) and [all public types](globals.md).

Create `Hooks/<name>.ts` using the normal document editing tools. Export a default
async function taking `HookServices` and returning `Promise<string>`. The types
are available without imports. Bind it on a conversation edge with
`#### Run: <name>.ts`. Creating or editing source validates it without running it.

Hooks execute before recording the conversation transition. Effects already
committed by a service are not rolled back if a later call fails. Make hooks
retry-safe. A rejected callback changes nothing in that fixture move.

Hooks have no filesystem, network or application imports. The host bounds runtime
execution and service calls. Character response models never execute hooks.
Quest lifecycle hooks are not part of this PoC.

These pages are read-only in the document service. Edit source comments in
`packages/hooks/src/services.ts` and run `proto run moon -- run workspace:hooksDocsGenerate`
to regenerate them. Run `proto run moon -- run workspace:hooksDocsCheck` to check drift.
