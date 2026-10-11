---
title: "Design: one GM tool registry with a single result and error shape"
labels: [design, tech-debt, gm]
---

## Observation

GM tools wrap services, but each one follows its own conventions:

- In `packages/conversation/src/gm-tools.ts`:
  - Document tools return `{ok, error, current}`.
  - `read_inventory` returns the raw value (:63), and `list_*` return their own shapes (:80-90).
  - `update_inventories` throws `InvalidReviewError` for bad arguments but returns `ok:false` on conflict (:65-78).
  - Activity tools return `{staged:false, committed:true}` (:114) and throw a plain `Error` when `characterId` is missing (:108). A plain `Error` aborts the whole review instead of being returned for correction (`packages/conversation/src/game-master.ts:44-47`).
  - Descriptions are inline English in some places (:23-24) and `renderPrompt` templates in others.
- Only `packages/conversation/src/document-tools.ts:26-32` validates arguments against the schema.
- `packages/conversation/src/memory-tool.ts:33` returns `"memory_error"`.
- The Stranger interview runs a separate GM tool loop with its own `JSON.parse` and `{ok:false, error:String(e)}` (`apps/web/src/stranger-interview.ts:58-97`), not `runGameMaster`.
- The arrest tool is a third style (see #13).

## Why it doesn't pass the sniff test

The GM learns a different recovery for every tool, and so does every eval and test. Tools are effectively the GM's service interface, so they should be as uniform as the services.

## Threads to pull

- One registry entry shape: `{definition, validate, execute(services)}` with one loop (`runGameMaster`) and one result type, for example `{ok:true, value} | {ok:false, error:"invalid"|"conflict", current?}`.
- Should argument validation always come from the JSON schema?
- Should the Stranger interview use the same loop and registry?
- Ties into #05: conflicts would map from one error type.
