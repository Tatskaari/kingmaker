# Context compaction, world state and re-hydration for long scenes

Research for the V2 PoC on keeping long scenes on track: what the APIs and libraries offer for compaction, what roleplay products do, and a design for a background world-state tracker, compaction and re-hydration. It answers the brief's questions: "Is there a lib or a built-in API for this?" and "When we compact, re-inject the little notes about what each character is doing and where we are in the plot."

**Method.** I read the docs (cited inline, collected at the end) and ran small live probes against OpenRouter on 2026-10-14 (`openai/gpt-6-luna` with reasoning `none`, and `openai/gpt-6-luna-decisions`). The probes replayed the largest logged GM prompt from `runs/` (green-standoff, 13 player turns, 9,153 tokens). Each probe ran 1–2 times on one scene, so treat the latencies as indicative. Appendix A has the method and the raw numbers. Related docs: [FINDINGS](../FINDINGS.md) (open question on continuity), [QA round 2 FM-H](../qa/round-2-analysis.md), [v1-systems §2–3](v1-systems.md) (progressive disclosure, background fact recording) and [ai-gm-and-craft §1.7, §3.6](ai-gm-and-craft.md) (Friends & Fables, AI Dungeon).

## TL;DR

1. **The context window isn't our problem yet. Continuity is.** GM prompts grow by about 300 tokens per exchange. The largest logged one was 9.4k tokens (scenes of 12–15 player turns), and Luna takes 1.05M. What breaks in long scenes is state: names used before anyone said them, props in the wrong hands, frozen clocks, "who is on the rope" (QA r2 FM-H, FINDINGS open question). Ending judgements also miss states reached many turns ago. **Build the world-state tracker first. Compaction comes second, for long scenes and sessions.**
2. **No usable built-in compaction for Luna on OpenRouter.**
   - OpenAI's Responses API has server-side compaction (`context_management`) and `POST /responses/compact`. Both return an *opaque, encrypted* compaction item.
   - OpenRouter's Responses API is stateless: `previous_response_id` is rejected with a 400, and `/api/v1/responses/compact` returns 404.
   - OpenRouter forwards `context_management` upstream, but the compaction item never comes back. In the probe the compaction pass ran (2,202 reasoning tokens despite effort `none`), first text arrived at **11.0 s**, the reply finished at 19.6 s, and no item reached the stream or the output.
   - The only compression OpenRouter offers is the `context-compression` plugin. It is "middle-out" truncation, not summarisation.
   - Anthropic's compaction returns a *readable* summary, with custom instructions, kept recent turns and background swaps, but it is Claude-only. **Write our own compaction and copy Anthropic's semantics.**
3. **No library is worth adopting. Several patterns are worth copying:**
   - LangChain's trigger/keep thresholds;
   - LlamaIndex's prioritised memory blocks under a token budget;
   - Letta's labelled, size-limited blocks edited by a background "sleep-time" agent;
   - Mem0's ADD/UPDATE/DELETE/NOOP updates;
   - Zep's time-stamped facts that get invalidated rather than overwritten.

   Our loop is custom TypeScript on two OpenRouter endpoints, and each piece is about 100–200 lines.
4. **The design has three small parts, all off the critical path.**
   - **(a) A world-state tracker (the ledger).** Structured and keyed: where each person is, what they're doing, their intent and attitude, who holds what, agreements with exact terms, facts marked fact/belief/claim with who knows them, introductions, the clock, and the plot position. It is updated in the background after replies that changed something, and rendered every turn as a short "How things stand" block at the end of the prompt.
   - **(b) A rolling summary with a verbatim tail.** The older exchanges become "the story so far", written recursively. The last 8 exchanges stay word for word, and the summary is swapped in at a turn boundary.
   - **(c) Re-hydration.** Pin the ledger and the summary. Select notes with the decision model, as in V1's progressive disclosure.
5. **Luna decisions works as a note selector.**
   - **Latency:** 8 notes took about 0.4 s, 32 notes 0.34–0.66 s, 96 notes 0.65–1.3 s and 192 notes about 0.8 s. Answers were deterministic.
   - **Cost:** about $0.000026 per note per turn, so prefilter to roughly 40 candidates.
   - **It re-opens what compaction removed.** With the full recent transcript in its state, 1 of 6 relevant notes cleared V1's 0.7 threshold, because the rest were already visible. With a compacted state, 5 of 6 cleared it.
   - **It skipped the one promise note (p = 0.10)**, so **pin agreements in the ledger; don't leave them to selection.**
6. **Caching already works, so protect it.**
   - The current layout (stable brief, append-only history, volatile "now" note last) gets implicit cache hits up to the latest player message: 7,769 of 9,153 tokens, and the next turn writes only about 60 new tokens.
   - Logged GM calls pay a median 0.26–0.31× the uncached input rate.
   - Compaction resets that. After a simulated compaction, implicit caching hit **0** tokens; with an explicit breakpoint after the brief it hit **4,603**.
   - Also send `session_id`: OpenRouter's default sticky key hashes the first messages, which compaction changes.
   - At our sizes caching saves cost, not time. First text was 0.75–1.7 s warm or cold at 9k tokens, 1.2–2.2 s at 22k and 1.6–1.8 s at 47k.
7. **Nothing heavy enters the 5 s path.**
   - The tracker takes 2–7 s, compaction about 4 s and selection pre-computation about 0.5 s. All run in a per-session background queue after the text is shown.
   - The only new critical-path cost is an occasional speculative-reply restart (about +0.4 s) when a newly selected note changes the prompt.
8. **Test it with a continuity eval before building more.**
   - Use late-turn snapshots from long sessions, probing early state.
   - Compare full history, +ledger, summary+tail, and summary+tail+ledger(+notes).
   - Measure contradictions, latency, cache hits and cost.
   - Hypothesis: the ledger carries most of the gain. Compaction is neutral to positive on quality, and positive on cost and focus in long scenes.

---

## 1. Where the PoC stands (measured from `runs/`)

**Prompt size grows slowly.** Median GM input tokens by player turn, over 6,610 logged `gm.*` calls:

| player turns in prompt | 1 | 3 | 5 | 7 | 9 | 11 | 13–15 |
|---|---|---|---|---|---|---|---|
| median input tokens | 2,805 | 3,323 | 4,070 | 4,590 | 4,982 | 5,901 | 8,669–9,250 |
| median first text (ms) | 935 | 902 | 943 | 942 | 964 | 1,035 | 856–1,013 |

That is about 300 tokens per exchange, so a 45-turn scene like QA r2's `hanged-clerk` session would be about 20k tokens. The largest logged prompt (9,153 tokens) breaks down as:
- `instructions` plus the scene brief: about 4.6k tokens;
- history (26 messages): about 3.2k tokens;
- the volatile "now" note: about 1.4k tokens (derived from the cache probe).

The GM prompt is mostly prep, not transcript.

**Caching already pays.** GM calls in the logs pay a median 0.26–0.31× the uncached input rate (estimated from logged cost and token counts), which means about 75–80% of input tokens are read from cache. `sceneBrief` already says it is the "cache-friendly prefix".

**Continuity is where it breaks:**
- FINDINGS: "Long sessions (20+ turns) still show continuity slips: positions, sums, who is on the rope."
- QA r2 FM-H:
  - names used in narration before anyone said them;
  - a character reading a page the player is holding;
  - a frozen sunset, and the quarter bell ringing twice;
  - constables who "finish loading Prout" three times.

  Its fix hypothesis was to "track introductions" and "add a 'who holds what' line to each turn's note".
- QA r2 also found the after-reply question "asks about events, not the current state": a signing reached at t34 scored 0.04 at t40 because it was no longer new.

Research agrees that models track state changes badly. Kim and Schuster found entity tracking fragile ([ACL 2023](https://arxiv.org/abs/2305.02363)). A 2026 follow-up found that LMs "do not incrementally track world states" and implement removal "with a fragile global suppression tag" ([Tang et al. 2026](https://arxiv.org/abs/2605.30233)). Items handed over and people who left are exactly what slips.

**Scene-level compaction already exists.** The exit hand-off (`writeHandoff` in `engine.ts`) records "who is where and in what state, who holds what, what was promised", plus the last moments word for word. It just runs only once per scene, and from the raw transcript.

## 2. Built-in APIs

### 2.1 OpenAI Responses API (direct)

- **Server-side compaction.** Set `context_management: [{ type: "compaction", compact_threshold: 200000 }]` on `POST /responses`. "When the rendered token count crosses the configured threshold, the server runs server-side compaction", and "the response stream includes the encrypted compaction item". The item is "opaque and not intended to be human-interpretable". It is ZDR-friendly with `store: false`. With stateless chaining you may drop the items before the latest compaction item; with `previous_response_id`, don't prune ([Compaction guide](https://developers.openai.com/api/docs/guides/compaction), [create reference](https://developers.openai.com/api/reference/resources/responses/methods/create)).
- **Standalone `POST /responses/compact`.**
  - It is "fully stateless and ZDR-friendly". It returns a new window: an encrypted compaction item plus "retained items from the previous window". The guide says "do not prune `/responses/compact` output."
  - The body takes `model` (`gpt-6-luna` is listed), `input`, `instructions`, `previous_response_id`, `prompt_cache_key` and `prompt_cache_options`. The response is `object: "response.compaction"` with `usage`.
  - Sources: [compact reference](https://developers.openai.com/api/reference/resources/responses/methods/compact). The OpenAI Agents SDK wraps it as `OpenAIResponsesCompactionSession`, which can auto-compact or "call `run_compaction()` manually between turns" ([SDK reference](https://openai.github.io/openai-agents-python/ref/memory/openai_responses_compaction_session/)).
- **`truncation`.** `auto` drops "items from the beginning of the conversation" when the input exceeds the window. `disabled` (the default) returns a 400. For us that would drop the brief first.
- **Conversation state.** The options are manual input arrays, `previous_response_id`, or the durable Conversations API. "Even when using `previous_response_id`, all previous input tokens for responses in the chain are billed as input tokens" ([conversation state](https://developers.openai.com/api/docs/guides/conversation-state)).
- **Reasoning items.** Stateless requests return encrypted reasoning items; replay every output item to keep them. `reasoning.context: "all_turns"` renders earlier turns' reasoning on supporting models ([reasoning guide](https://developers.openai.com/api/docs/guides/reasoning), [OpenRouter GPT-5.6 guide](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gpt-5-6.md)). **This doesn't matter for our GM**, because effort `none` produces no reasoning items. The single-shot co-GM and scribe calls carry none forward either.
- **Prompt caching** (GPT-5.6 and later, so Luna; [guide](https://developers.openai.com/api/docs/guides/prompt-caching)):
  - The minimum cacheable prefix is 1,024 tokens. The TTL is `30m`. Writes cost 1.25× and reads 0.1×.
  - The implicit breakpoint sits "at the end of the latest eligible message". Eligible messages are user messages, the last tool response in a group, and "the last developer message in the initial consecutive group".
  - Each request can create "up to four cache writes". Explicit `prompt_cache_breakpoint` markers go on `input_text` blocks, and "top-level `instructions` cannot contain an explicit breakpoint".
  - Changing `model`, `tools`, `text.format`, `reasoning.effort` or `context_management` breaks reuse. On GPT-6, a `configuration_update` input item changes effort without rewriting the prefix ([GPT-6 guide](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gpt-6.md)).
  - On compaction: it "can change the prefix, so the first request after compaction may reuse less of the previous cache."

### 2.2 What OpenRouter exposes for `openai/gpt-6-luna`

| feature | status on OpenRouter | evidence |
|---|---|---|
| Stateful chaining (`previous_response_id`, Conversations) | **No.** "Not supported on this proxy… Requests with a non-null value are rejected with a 400 error. Send the full conversation history in `input` instead." `store` is fixed at `false`. | [OpenAPI spec](https://openrouter.ai/docs/openapi/openapi.yaml), [GPT-6 guide](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gpt-6.md) |
| `POST /responses/compact` | **No.** `/api/v1/responses/compact` returns 404. | probe |
| `context_management` compaction | **Not usable.** It isn't in the documented request schema, but it is forwarded. With `compact_threshold: 2000` on the 9.1k-token prompt, the compaction pass ran and no compaction item came back in the output or the stream. | probe: 10,699 in / 2,356 out (2,202 reasoning) tokens, $0.0022, first text 11.0 s, total 19.6 s. With `max_output_tokens: 600` it ended `incomplete` with empty output |
| Compaction items as *input* | The schema accepts `compaction` and `context_compaction` items, but nothing on OpenRouter produces them for us. | OpenAPI spec |
| `truncation` (`auto`/`disabled`) | Accepted. It has OpenAI's semantics: it drops from the start. | OpenAPI spec |
| `plugins: [{ id: "context-compression" }]` | "Removing or truncating messages from the middle of the prompt, until the prompt fits". The only engine is `middle-out`. It is on by default only for endpoints with 8k context or less. It doesn't summarise, so it isn't relevant at 1.05M. | [Message transforms](https://openrouter.ai/docs/guides/features/message-transforms.md) |
| Prompt caching | Automatic for OpenAI, plus `prompt_cache_breakpoint`, `prompt_cache_options {mode, ttl}` and `prompt_cache_key`. Usage reports `input_tokens_details.cached_tokens` and `cache_write_tokens`. | [Prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching.md), [GPT-5.6 guide](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gpt-5-6.md) |
| Sticky routing | Tracked "per conversation", which is identified by "hashing the first system (or developer) message and the first non-system message". Sticky sessions expire after 10 minutes idle. `session_id` "uses it directly as the sticky routing key" and activates "before cache usage is observed". | Prompt caching doc |
| Luna pricing and limits | $0.10/M input, $0.50/M output, $0.01/M cache read, $0.125/M cache write. Above 272k prompt tokens the prices double. Context is 1.05M (max prompt 922k). It is served by OpenAI (standard, flex, fast), Azure and Bedrock endpoints, and caches are per provider. | [endpoints JSON](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints) |

The PoC sends no `session_id` today. After compaction, the "first non-system message" changes, so the default sticky key moves and the next request may land on a provider with a cold cache. In one probe, the identical prompt under a new session id missed a cache that had been warm minutes earlier.

### 2.3 Anthropic, for comparison

- **Compaction on demand** (beta `compact-2026-09-04`):
  - **Request.** Send the conversation with `"compaction": {"type": "summarize"}`. It "returns the block alone with `stop_reason` `"compaction"`": a readable summary plus a signature. Put it first in later requests in place of the messages it summarises.
  - **Custom prompt.** "A non-blank `instructions` string (up to 16,384 characters) replaces that prompt entirely."
  - **Variants.** You can [keep recent turns](https://platform.claude.com/docs/en/build-with-claude/compaction-keep-recent-turns) (send only the older turns), [compact in the background](https://platform.claude.com/docs/en/build-with-claude/compaction-background) ("drop exactly the messages you sent from the front of your history… Every turn appended since step 1 stays after it"), and compact again.
  - Source: [on-demand](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand), [overview](https://platform.claude.com/docs/en/build-with-claude/compaction).
- **Threshold compaction.** `context_management.edits: [{ type: "compact_20260112", trigger: { type: "input_tokens", value: 150000 } }]`. The trigger must be at least 50,000. It also takes `pause_after_compaction` and `instructions`. The default prompt asks for "a summary of the transcript… to provide continuity… including the state, next steps, learnings" ([threshold](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)).
- **Context editing** clears old tool results or thinking (`clear_tool_uses_20250919`, `clear_thinking_20251015`). Its own docs point to "server-side compaction" as "the primary strategy" ([context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)).
- **Caching advice.** "Add a `cache_control` breakpoint at the end of your system prompt… Only the compaction summary needs to be written as a new cache entry."
- **The engineering guidance** frames compaction as recall first, then precision: "Start by maximizing recall… then iterate to improve precision". It pairs compaction with "structured note-taking… persisted to memory outside of the context window" ([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

### 2.4 What this means for us

A built-in route would only be possible by calling OpenAI directly, and even then the compaction item is encrypted. Neither the decider, the hand-off writer, the scribe, the co-GM nor an eval judge could read it, and we couldn't re-inject per-character notes around it. Our summary should be plain text that we write, inspect and test. Anthropic's on-demand design is the right model: a custom summarisation prompt, a verbatim tail, a background request, and a swap at a turn boundary.

## 3. Libraries and research patterns

| library | mechanism | what to borrow |
|---|---|---|
| **LangChain v1 `SummarizationMiddleware`** ([docs](https://docs.langchain.com/oss/python/langchain/middleware/built-in)); **LangGraph** summary key plus `RemoveMessage` ([docs](https://docs.langchain.com/oss/python/langgraph/add-memory)) | `trigger` by tokens, messages or a fraction of the window (AND within a clause, OR across clauses). `keep` defaults to 20 messages. Custom `summary_prompt`. `trim_tokens_to_summarize` defaults to 4,000. LangGraph's pattern: "Extend the summary by taking into account the new messages above". | Trigger and keep semantics with hysteresis; recursive extension of the previous summary. |
| **LlamaIndex `Memory`** ([docs](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)) | `token_limit` (default 30,000), `chat_history_token_ratio` (0.7) and `token_flush_size` (3,000). Flushed messages feed memory blocks: `StaticMemoryBlock`, `FactExtractionMemoryBlock` (`max_facts`, self-summarising when full) and `VectorMemoryBlock`. `priority=0` blocks are "always kept"; the others are truncated by priority. | Flushing into blocks, with a priority-ordered token budget for re-injected material. |
| **Letta / MemGPT** ([memory blocks](https://letta.com/blog/memory-blocks), [agent memory](https://www.letta.com/blog/agent-memory), [MemGPT](https://arxiv.org/abs/2310.08560), [sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime)) | Blocks have a label, description, value and size limit, and are "pinned" in context. Evict "only a portion (e.g., 70%) of messages", which then "undergo recursive summarization". Recall memory is searchable history; archival memory is indexed knowledge. Sleep-time agents "run in the background and can modify the memory asynchronously". | The ledger as labelled, size-capped blocks maintained by a background agent; partial eviction; full history kept for search. |
| **Mem0** ([paper](https://arxiv.org/abs/2504.19413)) | Extraction uses a rolling summary plus recent messages, followed by ADD / UPDATE / DELETE / NOOP against existing memories. It reports 26% relative LLM-judge gains, "91% lower p95 latency" and ">90% token cost" savings against full context. | Keyed upserts against existing state instead of appending, which avoids "competing accounts". |
| **Zep / Graphiti** ([paper](https://arxiv.org/abs/2501.13956)) | A temporal knowledge graph with bi-temporal validity and edge invalidation. It reports up to 18.5% accuracy gains and 90% lower latency on LongMemEval. | Stamp ledger entries with the turn they became true. Invalidate rather than overwrite, so the scribe sees history ("held the page until t22"). |

**Research worth applying:**
- **Recursive summarisation.** The model "recursively produce[s] new memory using previous memory and following contexts" ([Wang et al. 2023](https://arxiv.org/abs/2308.15022)). This is the cheap way to keep a bounded "story so far".
- **Position matters.** Performance is "highest when relevant information occurs at the beginning or end of the input context" ([Liu et al., Lost in the Middle](https://arxiv.org/abs/2307.03172)). Put state at the end.
- **Context rot.** Models "do not use their context uniformly", and there is "significantly higher performance on focused prompts compared to full prompts" on LongMemEval ([Chroma](https://www.trychroma.com/research/context-rot)). This is the case for compaction even when the window has room.
- **Generative Agents' memory stream** retrieves by recency, importance and relevance ([Park et al. 2023](https://arxiv.org/abs/2304.03442)). It's a useful model for scoring notes if selection ever needs ranking rather than yes/no.

## 4. What roleplay products do

| product | compaction | state and memory | placement |
|---|---|---|---|
| **AI Dungeon** ([Memory System](https://help.aidungeon.com/faq/the-memory-system), [context](https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai)) | A memory every 6 actions, summarising the 6 actions *before* the latest 6 (first at action 12). A "Story Summary" every 15 actions. | Memory Bank retrieval by embeddings (25–400 memories by tier). Plot Essentials. Story Cards triggered by keywords. | Author's Note next to last. About 50% history, 25% Memory Bank and 25% cards (per [ai-gm-and-craft §3.6](ai-gm-and-craft.md)). |
| **SillyTavern** ([Summarize](https://docs.sillytavern.app/extensions/summarize/), [Author's Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/), [World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)) | Summarise every N messages or N words, blocking or not, with a `{{summary}}` template. It warns that summaries "may lose some important details or contain hallucinations". | Lorebooks activated by keywords (or vectors), with a scan depth, a token budget and recursion. Timed effects: sticky, cooldown and delay. | "The closer the Author's Note is to the bottom of the prompt, the more impact it has." |
| **Friends & Fables / Craft** ([Memories](https://help.fables.gg/articles/2838157-memories), [Plot and Plan](https://help.fables.gg/articles/4217496-plot-and-plan), [Context blocks](https://help.fables.gg/articles/8560008-working-context-blocks), [Context Management](https://help.fables.gg/articles/5272453-whats-the-maximum-context-size-how-do-i-manage-context)) | A rolling "Plot" summary (every 3 turns since 26.03). Memories "every 5 turns", tagged to characters and places. | A research step fills **context blocks** with budgets and priorities; "blocks will expire". Per-NPC memories (the 20 most recent). The plan is "rewritten each turn" and discarded. Craft has Pinned, Partial and Searchable visibility. | "The last 5 to 8 messages" plus the plot summary ([ai-gm-and-craft §1.3](ai-gm-and-craft.md)). |

**Lessons:**
- Everyone keeps a recent tail verbatim and compresses the past.
- Everyone keeps durable state outside the prose. F&F: "the data you see in the UI is the truth".
- Retrieval is budgeted and expires.
- Steering text works best near the end of the prompt.
- Persistent plans made F&F railroady, so plans stay ephemeral. Our co-GM notes already expire.
- "Arguing is counter-productive as the entire chat history will be consumed": out-of-character loops should be dropped from what gets compacted.

---

## 5. Recommended design

### 5.1 Principles

1. **State lives in a structured record. Prose lives in the summary.** The ledger says what *is*. The summary says *how it got there* and must not restate positions or holdings, so the two can't disagree.
2. **Never on the critical path.** All writers run after the text is shown, in an ordered per-session queue, like V1's review queue. A turn always uses the latest committed version.
3. **Pin what must never be missed; select what might help.** The ledger and the story so far are pinned. Notes are selected by the decision model.
4. **Keep the cache-stable prefix stable.** Put prep first and the summary after it. History is append-only. Everything volatile goes in the tail.
5. **Play outranks prep, and the latest exchanges outrank the ledger.** The tail is verbatim, so a ledger one turn behind is harmless.

### 5.2 The world-state tracker (ledger)

This is a per-scene record. It carries across scenes through the hand-off, and the scribe reads it at the exit. It replaces `state.canon`; `state.established` becomes facts with `source: "authored"`.

```ts
interface Ledger {
  version: number; asOfTurn: number;
  clock: string;                                   // "dusk: the sun has touched the hill" (fixes frozen clocks)
  people: Record<string, {                         // cast ids and "player"
    where: string; doing: string;                  // anchor id or short phrase; posture or current action
    intent: string;                                // what they're trying to do now, from play
    attitude: Attitude; attitudeWhy: string;       // reuse the DSL enum in src/world/dsl.ts
    condition?: string;                            // wounded, bound, gagged…
    introduced: boolean;                           // has the player heard their name? (FM-H)
    knowsPlayerName: boolean;
    since: number;                                 // turn this row last changed
  }>;
  items: Record<string, { name: string; holder: string; state?: string; since: number }>;  // holder: id | "player" | anchor
  agreements: Record<string, { by: string; to: string; terms: string;                     // exact terms, quoted where possible
    status: "offered" | "agreed" | "fulfilled" | "broken" | "refused" | "withdrawn"; since: number }>;
  facts: Record<string, { text: string; status: "fact" | "belief" | "claim"; knownBy: string[]; source: "play" | "authored"; since: number }>;
  plot: { beat: string; settled: string[]; openThreads: string[]; essentialsLanded: string[] };  // "settled": states reached, not events
}
```

**Write path:**

1. **Gate it in the existing after-reply decision call.** Add a few `noul` questions in that call: did someone move or leave, did something change hands, was something offered, agreed, refused or broken, did someone's attitude or aim shift, was a concrete detail improvised, did time pass? The call already runs after the text is shown at about 0.27 s, and V1 found "nothing flagged" is the common case.
2. **When something is flagged, run the tracker.** It is Luna with effort `none` and a strict JSON schema whose ids are enums of cast, anchors and item keys, like the co-GM's. Given the ledger and the new exchange, it returns **keyed upserts and removals only**.
   - In the probe, an unconstrained delta for 2 exchanges took **7.4 s for 746 output tokens**: it restated unchanged rows and recorded intentions as moves.
   - Capped at about 200 tokens of changes, expect about 2–3 s at Luna's roughly 100 tokens/s.
   - A first catch-up over 22 messages took 9.7 s ($0.0014).
3. **Validate and apply.** Drop unknown ids, and never apply an offer as a transfer. Then bump `version` and append the ops to an event log. The ops map onto the world DSL: `moveTo`, `giveItem`/`takeItem`, `setAttitude`, `promise`, `remember`. The scribe and the hand-off can then reconcile authored exit scripts against them instead of re-reading the transcript.
4. **Use the tracker prompt's framing**, in the repo's prompt style: "You keep the record of a live scene so the GM never loses track of it… Record what the story has now established, not what was planned: offers, threats and intentions aren't moves or handovers until they happen. Keep the exact terms of anything agreed. Mark improvised details as fact, someone's belief, or an unverified claim, and who knows them (V1's discipline). Return only what changed."

**Read path:**

- **In the GM's tail**, render it every turn as "How things stand", in at most about 400 tokens, replacing "Details established in play". It sits before "Where the scene is now" and "For this reply":

  ```
  ## How things stand (as of the last exchange; what just happened outranks this)
  - Time: dusk; the sun has touched the hill.
  - Hester Quill (wary): at the bounds-stone, the corn mother in her hand; wants the ward whole before dark.
  - Pip Callow (friendly): beside you; still choosing whether to come to the mill.
  - You hold: your longbow; the clerk's page.   Kell holds: nothing of yours.
  - Agreed: Abel's household gives bread and salt at the stone; Hester counts Sedgeford inside the ward once it's shared.
  - Open: seed grain at the burnt mill; Pip's amends.
  - Names the player has heard: Hester, Abel, Ned, Pip. Describe anyone else.
  ```

  These are the user's "little notes about what each character is doing and where we are in the plot". They are re-injected **every turn**, not only after compaction.
- **For the decider:** add the same block to `decisionState`. Then ending and outcome questions can see *states* such as `plot.settled`, fixing the QA r2 "event vs state" miss, beyond the last 12 entries.
- **For the actors approach:** each actor gets only their own row and the facts they know. That keeps V1's knowledge isolation.

### 5.3 Compaction

**When:**
- Compact by exchanges, never by context window. A soft trigger fires when the history beyond the current summary passes about **6k tokens (about 20 exchanges)**, or at a beat change once 12 or more exchanges have passed since the last compaction. Beats are natural chapter breaks.
- Compact down to the **last 8 exchanges** verbatim. F&F keeps the last 5–8 messages, LangChain keeps 20 messages by default, and AI Dungeon keeps the latest 6 actions out of memories.
- The hysteresis means a compaction about every 12 exchanges. Each one costs one partially cold cache turn, so fewer, larger compactions are cheaper.
- Defer compaction while `pendingExit`, `closing` or a roll's resolution is in flight.
- Start with these numbers and tune them in the eval.

**What stays verbatim:**
- the `instructions` and scene brief (prep is never summarised);
- the previous scene's hand-off and last moments (already in the brief);
- the last 8 exchanges, with their roll lines and narration together (cut only on exchange boundaries);
- the ledger, re-rendered fresh, including agreement terms quoted exactly;
- any opened notes.

**What gets summarised** is the older exchanges, into "The story so far". That covers:
- what the player tried and how it went;
- rolls with their numbers and consequences (the probe summary kept "Persuasion failed (9 vs DC 13)");
- decisions and the reasons behind them;
- the turns of feeling that explain how people stand now.

It is recursive: the new summary is built from the old summary plus the newly evicted exchanges, so the summarisation cost stays bounded.

**What gets dropped:**
- out-of-character exchanges, which are already answered outside the fiction;
- correction or argument loops;
- co-GM notes and whispers (ephemeral by design);
- per-turn "now" notes (never part of history anyway);
- narration that repeats itself.

**How:** a background Luna call with effort `none`. The probe took 4.1 s and $0.001 for 22 messages into about 300 tokens. The prompt's framing:

> You're compressing the earlier part of a live scene so the GM can carry on without the full transcript. How things stand (positions, items, agreements) is recorded separately: don't restate it. Write the story so far: what the player tried and how it went, rolls and their consequences, what was decided and why, and the turns of feeling that explain where people stand now. Concrete names and numbers, nothing that didn't happen, nothing said out of character. Extend the previous story so far; at most 200 words.

Ask the same call for up to five **detail notes**: things a player might come back to, such as the exact wording of a sign, a price, or what was in a pocket. Each gets a one-line retrieval summary in everyday words plus the verbatim excerpt and its turn. They go into the note store (§5.4), so evicted details stay retrievable without costing attention. Letta's recall memory does the same thing. The full transcript also stays in `state.transcript` for audits and regeneration.

**Swap protocol** (Anthropic's background rule):
1. Record which exchanges went into the request, and keep playing on full history while it runs.
2. When the summary lands, replace exactly those exchanges at the next turn boundary. Turns added meanwhile stay after it.
3. Optionally, run a decision-model check first: "does this summary contradict the ledger or the kept exchanges?". On failure or a contradiction, keep full history and retry later. Nothing is ever lost.

### 5.4 Re-hydration: pinned state plus selected notes (V1's progressive disclosure)

**Pinned, every turn:**
- the ledger block (tail);
- the story so far (prefix);
- the scene's essentials status;
- **agreements** (inside the ledger). In the probe, the selector scored the promise note at 0.10 even after compaction, so commitments can't depend on selection.

**Selected:** a note store ported from V1's `LoreService`/`DisclosureSession` ([v1-systems §2](v1-systems.md#2-progressive-disclosure)).
- **Format:** markdown with frontmatter `summary`, `visibility`, `readers`, plus `scene`, `characters` and `turn`.
- **Sources:**
  - authored lore;
  - per-NPC first-person memories written at scene exit and at milestones (V1 §3.7);
  - compaction detail notes;
  - earlier scenes' hand-offs and ledgers.
- **Summaries "written for retrieval"** with everyday topic words, per V1's authoring contract.
- **Candidates:** notes permitted for this call, checked fail-closed, scoped to the present cast or the scene, minus notes already open. Cap at about 40.
- **The call:** one Luna-decisions request per turn with one `noul` question per candidate, in V1's wording:

  ```json
  { "model": "openai/gpt-6-luna-decisions",
    "state": { "how_things_stand": "…", "story_so_far": "…", "recent_exchanges": "…", "latest_turn": "…" },
    "questions": { "note_17": { "type": "noul",
      "instructions": "Judge this note independently. Would opening it help the next reply stay consistent with what happened in play or with what the people here know? The summary is a retrieval hint, not the note itself; don't guess its contents. Choose false if the current context is enough or the topic is unrelated.",
      "criteria": { "true": "Open the note: \"Pip Callow: why she took the corn mother…\"", "false": "Don't open this note for the next reply." } } } }
  ```

  Open the note when p > 0.7 (V1's threshold), then calibrate on labelled cases. FINDINGS says to scale thresholds with the cost of a mistake.

  The same `Decider` interface makes Jev a drop-in. Jev is cheaper ($0.042/M) but less accurate on our suite, and capped at a 32k prompt.
- **Timing:**
  1. Pre-compute the next turn's selection after the post-reply decision, keyed on the GM's last reply and the ledger. That adds no latency.
  2. At the player's turn, re-select in a **separate parallel call** to the pre-reply decision (about 0.4–0.7 s with 40 or fewer notes).
  3. If it opens something new, treat it like a decision that changed the prompt: restart the speculative reply, at about +0.4 s on those turns only. Or let the note land next turn, as the background co-GM's notes do.
  4. Keep V1's single round per turn on the critical path. Follow links in opened notes in the background pre-computation.
- **Placement and expiry:**
  - Opened notes go in the tail as "What Hester knows (only she knows this)". That keeps secrets attributed in single-GM mode, where V1 warned about bleed, and doesn't disturb the cached prefix.
  - Notes stay open while re-selected. Drop them after 3 turns without re-selection (SillyTavern's "sticky"/F&F's expiring blocks), within a token budget of about 1.5k by priority (LlamaIndex).
- **Why it fits re-hydration:** with the transcript still in view, the selector skipped notes whose content was visible (1 of 6 above 0.7). After compaction removed that content, it opened 5 of 6. It naturally brings back what compaction took out.

### 5.5 Prompt layout and caching

```
instructions (gm.md)                                    static; can't hold an explicit breakpoint
developer: scene brief          ◀ explicit breakpoint 1 static per scene
developer: the story so far     ◀ explicit breakpoint 2 changes only at compaction
history: kept exchanges, append-only
user: latest player turn        ◀ implicit breakpoint   (already happening: 7,769/9,153 tokens cached)
developer tail: how things stand · opened notes · where the scene is now · co-GM notes · for this reply   (uncached)
```

- **Add explicit `prompt_cache_breakpoint`s and keep implicit mode on.** Mark the brief and the summary as `input_text` blocks with `prompt_cache_breakpoint: { mode: "explicit" }`, and don't set `prompt_cache_options.mode: "explicit"`, or you lose the implicit history breakpoint. The implicit breakpoint takes one of the four write slots.
  - **Probe result:** after a simulated compaction, implicit caching alone read 0 tokens and wrote 5,141. With the brief breakpoint it read 4,603.
- **Send `session_id: state.id` on every GM and tracker call** so a session stays on one provider's cache across compactions.
- **Move volatile bits out of the brief.** Today `sceneBrief` changes when a character enters early ("Not on stage yet") and when an essential lands ("[already come across]"), which rewrites the cache from the brief onwards. Both belong in the tail.
- **Keep `reasoning.effort` and `text.format` fixed on the GM call**, because they are part of the cache key. If effort must vary, use GPT-6's `configuration_update`.
- **Log `cached_tokens` and `cache_write_tokens`** in `respond()`. Today we only log totals.
- **What to expect.** At our sizes caching is a **cost** lever:
  - A warm 9k-token GM call costs about $0.0003 against $0.0012 cold.
  - First text didn't differ measurably between cold and warm at 9k tokens (0.75–1.66 s).
  - It was 1.2–2.2 s at 22k and 1.6–1.8 s at 47k, with cold calls up to about 0.8 s slower.

  A compaction turn's cache miss therefore costs a fraction of a cent and a few hundred milliseconds at most. Running compaction *inline* is what would break the 5 s budget (11 s to first text in §2.2).

### 5.6 Turn timeline, budget and cost

```
player turn ─┬─ pre-reply decision (Luna decisions, ~0.28 s)
             ├─ note re-selection (Luna decisions, ≤40 notes, ~0.4–0.7 s, parallel)
             └─ speculative GM reply (prefix + kept exchanges + tail) ── first text ~1.0–1.4 s
                  (restart if the decision or a new note changes the prompt: +~0.4 s on those turns)
text shown ──── post-reply decision (~0.27 s) + "did state change?" flags in the same call
background ──── ledger update if flagged (2–7 s) → next-turn note pre-selection (~0.5 s)
                → compaction when due (~4 s, about every 12 exchanges) → swap at the next turn boundary
```

| call | per occurrence | how often | per turn |
|---|---|---|---|
| GM reply (warm cache) | ~$0.0003 | every turn | $0.0003 |
| ledger update | ~$0.0006 | flagged turns (assume half) | ~$0.0003 |
| note selection, 40 notes | ~$0.001 | every turn (pre-compute + re-select) | ~$0.001–0.002 |
| compaction summary | ~$0.001 | about every 12 exchanges | ~$0.0001 |

That's about $0.002–0.003 per turn in game calls, against under $0.001 today (FINDINGS). The selection calls are the largest share, so prefilter the candidates hard.

### 5.7 Where it plugs in (for whoever builds the PoC)

- **New `src/runtime/ledger.ts`:** the schema, the tracker call, op validation and apply, the event log, and rendering for GM, decider and actor views.
- **New `src/runtime/compaction.ts`:** triggers, the recursive summary with detail notes, and the swap.
- **New `src/runtime/notes.ts`:** the note store, permissions and selection through `Decider`, ported from V1's `DisclosureSession`.
- **`session.ts`:**
  - add `ledger`, `summary { text, throughTurn, version }` and `openNotes`;
  - add a background queue status;
  - retire `canon`.
- **`brief.ts`:**
  - render the story so far after the brief;
  - put "How things stand" and opened notes into `nowNote`;
  - move the presence and landed flags into the tail.
- **`voices.ts` `gmHistory`:** emit only exchanges after `summary.throughTurn`, and mark the cache breakpoints.
- **`openrouter.ts` `respond`:** add `sessionId`, content blocks with breakpoints, and cache usage logging.
- **`director.ts`:** add change flags to `decideAfter`, and the ledger to `decisionState`.
- **`engine.ts`:**
  - run the background queue after `playerTurn`;
  - make `writeHandoff` build from the ledger plus summary plus tail;
  - write per-NPC memory notes at exit.
- **`repair.ts`:** the co-GM reads the ledger and summary instead of the whole transcript.
- **`world/scribe.ts`:** "Established during play" comes from the ledger's event log.

### 5.8 Risks

- **Summary errors harden into canon.** F&F found that "each wrong turn becomes the context the next turn reasons from". Mitigations:
  - the ledger, not the summary, is the source of truth for state;
  - run the contradiction check before the swap;
  - keep the raw transcript so the summary can be regenerated.
- **Ledger errors.** In the probe, intentions were recorded as moves. Mitigations: tight op semantics, decision-model gating, and a labelled tracker eval.
- **Railroading.** An `intent` field can harden into a plan, as F&F's persistent plan did. Mitigations: intents come from play and are overwritten freely, and the tail frames them as "how things stand", not instructions.
- **Secret bleed** through opened notes in single-GM mode. Mitigation: label each note with who knows it, and check permissions fail-closed.
- **Cache churn.** Anything volatile ahead of the history breaks reuse. Mitigation: keep it in the tail.
- **Over-selection and bloat.** Mitigations: a budget, expiry, and the 0.7 threshold.

## 6. PoC and eval plan

1. **Continuity suite.** Take snapshots from long sessions:
   - QA r2 `hanged-clerk` t20–45 and `green-standoff` t10–18;
   - 40–60-turn simulated trajectories.

   Write probes whose right answer depends on early state: who holds the page, the terms agreed, a name not yet introduced, the time of day, the consequence of a roll, an attitude change. The judge criterion is contradiction plus the usual criterion pass.
2. **Conditions, each on the `v2` preset:**
   - **(a)** full history (baseline);
   - **(b)** full history plus the ledger;
   - **(c)** summary plus an 8-exchange tail;
   - **(d)** summary plus tail plus ledger;
   - **(e)** (d) plus selected notes.

   Force compaction early (a soft trigger of about 2k tokens) to amplify the effects.
3. **Metrics:**
   - contradiction rate and criterion pass;
   - first text and the share within 5 s;
   - input tokens and the cache-hit ratio (`cached_tokens / input_tokens`);
   - cost per turn;
   - tracker precision and recall on labelled ops;
   - selector precision and recall on labelled relevance, which also calibrates the 0.7 threshold.
4. **Hypotheses:**
   - (b) beats (a) on continuity at no latency cost.
   - (d) matches or beats (a) on quality, with fewer tokens and less self-imitation of old prose. The repetition guard exists because the model copies its recent replies.
   - (e) recovers details that (c) and (d) lose.
   - If (c) loses to (a) while (d) doesn't, the ledger is what makes compaction safe.

---

## Appendix A: probes run for this note (2026-10-14)

Scripts live in the session scratchpad (`…/scratchpad/compaction/`), which is temporary; this table is the record.
- All calls went to `https://openrouter.ai/api/v1/responses` with `openai/gpt-6-luna`, `reasoning.effort: "none"` and `store: false`, or to `/api/alpha/decisions` with `openai/gpt-6-luna-decisions`.
- The GM prompt is the logged `gm.reply` call with the most input tokens (9,153), from `runs/evals/20261014-090306-deviation/calls.jsonl`: green-standoff, 26 history messages.
- Each probe ran once or twice. Routing varies by provider.

| probe | result |
|---|---|
| Implicit caching, same prompt cold → warm | 0 read / 7,769 written ($0.00119) → 7,769 read ($0.00030). The tail "now" note (about 1.4k tokens) is never cached. |
| Next turn (one exchange appended, new "now" note) | 7,769 read, 59 written. The turn after: 7,828 read, 40 written. |
| First text, cold vs warm, at 9.2k tokens | Cold 0.89–1.39 s, warm 0.82–1.66 s: no measurable difference. |
| First text at larger sizes (history padded) | 21.9k tokens: cold 2.16 s, warm 1.21–1.38 s. 47.4k tokens: cold 1.79 s, warm 1.59–1.62 s. |
| Simulated compaction (summary in place of older history), implicit only | 0 read, 5,141 written. Repeat: 5,141 read. |
| The same, with an explicit breakpoint on the brief | 4,603 read on the first post-compaction call. |
| New `session_id`, same prompt warmed minutes earlier | 0 read (cold). Within one session id, hits were consistent. |
| `context_management: [{type:"compaction", compact_threshold:2000}]`, OpenAI provider only | Forwarded. 10,699 in / 2,356 out (2,202 reasoning) tokens, $0.0022. Streaming: first event 1.2 s, first text 11.0 s, done 19.6 s. Non-streaming: 26 s. No compaction item in output or stream. With `max_output_tokens: 600`: `incomplete` with empty output. With the threshold at 20,000: a normal reply. |
| `POST /api/v1/responses/compact` | HTTP 404. |
| Decisions note selection: 6 relevant notes plus distractors, `noul` each | 8 notes: 0.37–0.43 s, $0.00035. 32: 0.34–0.66 s, $0.00098. 96: 0.65–1.29 s, $0.0027. 192: 0.81–0.82 s, $0.0053. Answers were identical across repeats; distractors stayed at or below 0.13. |
| The same, relevant notes' p(open) | Full recent transcript in state: 0.20, 0.03, 0.85, 0.61, 0.10, 0.05 (1 of 6 above 0.7). Compacted state (a 2-sentence summary plus the latest turn): 0.89, **0.10 (the promise)**, 0.88, 0.84, 0.92, 0.96 (5 of 6). |
| Tracker (strict JSON ledger delta, Luna none) | Catch-up from 22 messages: 9.7 s, 974 out tokens, $0.0014. Delta for the last 2 exchanges: 7.4 s, 746 out tokens (it restated unchanged rows and logged intentions as moves), $0.0006. |
| Compaction summary (Luna none, at most 150 words asked) | 4.1 s, 307 out tokens, $0.001. Concrete, kept roll numbers, and correct as of the cut point. |

## Sources

**OpenAI:**
- [Compaction](https://developers.openai.com/api/docs/guides/compaction)
- [`/responses/compact` reference](https://developers.openai.com/api/reference/resources/responses/methods/compact)
- [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [Context management](https://developers.openai.com/api/docs/guides/context-management)
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [Reasoning](https://developers.openai.com/api/docs/guides/reasoning)
- [GPT-6 Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GPT-6 guide](https://developers.openai.com/api/docs/guides/latest-model)
- [Agents SDK compaction session](https://openai.github.io/openai-agents-python/ref/memory/openai_responses_compaction_session/)

**OpenRouter:**
- [Message transforms / context-compression](https://openrouter.ai/docs/guides/features/message-transforms.md)
- [Prompt caching and sticky routing](https://openrouter.ai/docs/guides/best-practices/prompt-caching.md)
- [GPT-5.6 migration (explicit caching, `reasoning.context`)](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gpt-5-6.md)
- [GPT-6 migration (stateless Responses, `configuration_update`)](https://openrouter.ai/docs/cookbook/evaluate-and-optimize/model-migrations/gpt-6.md)
- [OpenAPI spec](https://openrouter.ai/docs/openapi/openapi.yaml)
- [Luna endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints)
- [Luna decisions endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-luna-decisions/endpoints)
- [Jev tutorial (noul/choice/score)](https://openrouter.ai/docs/guides/community/jev-tutorial.md)

**Anthropic:**
- [Compaction overview](https://platform.claude.com/docs/en/build-with-claude/compaction)
- [On demand](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand)
- [Keep recent turns](https://platform.claude.com/docs/en/build-with-claude/compaction-keep-recent-turns)
- [Background](https://platform.claude.com/docs/en/build-with-claude/compaction-background)
- [Threshold](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)
- [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing)
- [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

**Libraries:**
- [LangChain middleware](https://docs.langchain.com/oss/python/langchain/middleware/built-in)
- [LangGraph memory](https://docs.langchain.com/oss/python/langgraph/add-memory)
- [LlamaIndex memory](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/)
- [Letta memory blocks](https://letta.com/blog/memory-blocks)
- [Letta agent memory](https://www.letta.com/blog/agent-memory)
- [Letta sleep-time agents](https://docs.letta.com/guides/agents/architectures/sleeptime)
- [Mem0](https://arxiv.org/abs/2504.19413)
- [Zep](https://arxiv.org/abs/2501.13956)

**Research:**
- [MemGPT](https://arxiv.org/abs/2310.08560)
- [Recursive summarisation](https://arxiv.org/abs/2308.15022)
- [Lost in the Middle](https://arxiv.org/abs/2307.03172)
- [Context rot](https://www.trychroma.com/research/context-rot)
- [Entity tracking (2023)](https://arxiv.org/abs/2305.02363)
- [Entity tracking across state changes (2026)](https://arxiv.org/abs/2605.30233)
- [Generative Agents](https://arxiv.org/abs/2304.03442)

**Products:**
- AI Dungeon: [Memory System](https://help.aidungeon.com/faq/the-memory-system), [context](https://help.aidungeon.com/faq/what-goes-into-the-context-sent-to-the-ai)
- SillyTavern: [Summarize](https://docs.sillytavern.app/extensions/summarize/), [Author's Note](https://docs.sillytavern.app/usage/core-concepts/authors-note/), [World Info](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)
- Friends & Fables: [Memories](https://help.fables.gg/articles/2838157-memories), [Plot and Plan](https://help.fables.gg/articles/4217496-plot-and-plan), [Context blocks](https://help.fables.gg/articles/8560008-working-context-blocks), [Context Management](https://help.fables.gg/articles/5272453-whats-the-maximum-context-size-how-do-i-manage-context)
- Further F&F and Craft sources: [ai-gm-and-craft.md](ai-gm-and-craft.md)

**Repo:**
- [FINDINGS](../FINDINGS.md)
- [QA round 2 analysis](../qa/round-2-analysis.md)
- [v1-systems §2–3](v1-systems.md)
- `src/runtime/{brief,voices,engine,director,repair}.ts`
- `src/world/{dsl,scribe}.ts`
