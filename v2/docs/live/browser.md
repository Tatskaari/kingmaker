# In a browser, live run, 2026-10-17

V14's page on real models, with no server ([browser-design.md](../browser-design.md) §7): the site as `npm run build:web` built it (stamp `f76942ba4742`, at dd8efb8), served as GitHub Pages serves a preview (hosts/web/serve.ts, under `/kingmaker/pr-preview/pr-0/v2/` on 127.0.0.1), in headless Chromium (Playwright 1.62.1's headless shell). The dev key was typed into the page's key form. The simulation, the AI service and the saves ran in the page's server worker, and every model call went from that worker straight to OpenRouter. A Playwright script in the author's scratchpad drove it, played as a player would through the page's own screens, and read the spend from the worker's IndexedDB as it went.

| | |
|---|---|
| Character | Tamsin Vell: a disgraced palace auditor with a ledger-keeper's eye and a borrowed rapier. The first of the GM's three cards: human fighter 3 (Champion), sage background. The page has no ready-made shortcut (that's the terminal client's `--build`), so the character was made from the sentence, which costs one call more |
| Turns | 2: the yard's opening and one line |
| Model | openai/gpt-6-luna, the pipeline's, through OpenRouter |
| Requests | 65: 41 to the page's own origin, 24 to openrouter.ai (the form's key check and 23 model calls), none anywhere else |
| Cost | **$0.0089**: the AI service's ledger as the page keeps it (`spent` in the IndexedDB database `kingmaker-v2-web /kingmaker/pr-preview/pr-0/v2/`), the same as the sum of its ten requests' costs in its log |
| The key | Kept in localStorage by the form. In no URL, console line, IndexedDB record or screen (each checked by the script) |
| Errors | None on the page or in either worker |

## How it went

| Step | What the page showed | Time and cost |
|---|---|---|
| The key form | The key checked with OpenRouter (`GET /api/v1/key`), then the title. The bar under the game: "Your OpenRouter key is kept in this browser. Change key · Forget it" | the title 773 ms after Play |
| A character | "Three ways to be Tamsin Vell": a human fighter (Champion), a human wizard (Evoker) and a human rogue (Thief), all sage. Enter took the first. The backstory skipped, the sheet the rules engine made: HP 28, AC 13, speed 35 ft | the offer: 8.2 s, 1 call, $0.0004 |
| Set off | The town's map in the granary lane, "The lead: The Hanged Clerk", 2 paces. `g` walked to it, and the yard opened | |
| The opening | (below) | 7.1 s, 6 calls (the opening and the four memories it's told), $0.0033; its notes 7.4 s, $0.0001 (none written); four suggested lines 3.1 s, $0.0008 |
| The line | "Sergeant, who found him, and when?" (below) | decide 0.6 s, $0.0015; the reply 1.6 s, $0.0006; then its notes $0.0005 (none written), settle $0.0007, the memory review $0.0002, four suggested lines $0.0008 |

The opening, as the page drew it:

> The yard smells of wet grain, pigeons and river mud. A small grey-coated clerk turns slowly from the hoist above the shut loft door; a pigeon watches from the beam. Below him, a scrawny boy in enormous black boots lobs gutter stones.
> "Missed! Cob never misses twice."
> From the wall, a sharp-faced girl swears in Common, then switches to dock cant for emphasis.
>
> The sergeant steps away from the gate, notebook open.
> "Sergeant Kell. The Captain's view is suicide."
> Her pencil pauses above the page.
> "I haven't signed it."
> A stone clangs off the hoist hook.

The line, and Kell's reply:

> **Tamsin Vell:** Sergeant, who found him, and when?
>
> Kell taps her pencil against the notebook once.
> "The porters found him at first light. They came through the gate and raised the alarm. They'd been told he was missing the evening before."
> Her gaze shifts briefly to the hanging clerk, then back to you.
> "They couldn't get up to him. The yard doors were locked, and the loft door was barred from inside."

The lines suggested after it: "Locked from inside, yet he's hanging outside. That deserves careful accounting."; "Sergeant, did the porters say who told them he was missing?"; "(I try to coax the girl in the shawl into explaining her curses, before Kell writes them off.)"; "(I try to question Cob gently about the stones, risking his silence if I sound like a magistrate.)".

## What it shows

- OpenRouter takes the browser's calls: the key check from the page, and the model calls from a worker, with no CORS refusal (from `http://127.0.0.1:7421` here; a preview's origin is `https://tatskaari.github.io`).
- The page host plays a scene on real models as the dev stack does: the same jobs in the same order (offer; open, notes, suggest; decide, reply, settle, remember, notes, suggest), each answered once, with nothing retried.
- The AI service's stores are kept with the game: after the line, IndexedDB held the call log (46 lines), the answers and the ledger, beside the simulation's rows.

## The first try

The same script ran a minute earlier and played the same scene for $0.0114 (the sum of the AI service's log lines; a different opening and reply, the same facts). But its probe of IndexedDB opened the database before the server worker had made it, which made it empty, so the worker couldn't read it back and said so on the bar ("This browser couldn't read back the games it kept; this one is kept as it goes"), and the ledger wasn't kept. That was the script's doing: it now opens the database only once it's there, as `npm run web:check` does. The two runs together cost $0.020.
