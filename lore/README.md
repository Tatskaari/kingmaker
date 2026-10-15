---
summary: "For developers, not part of the story: what the lore folder holds, its format, and which code reads it. It holds no facts about the world, so nothing found in play belongs here."
type: "readme"
visibility: "gm"
---
# lore: the authored lore

Part of the [architecture overview](../ARCHITECTURE.md).

The lore for the Caerwyn arc, in V1's docs format: Markdown with frontmatter, linked by relative links. It's the seed of the docs service ([src/lore](../src/lore/)): each game reads it through a copy of its own that play writes to, and nothing writes here.

This README has frontmatter because the docs service reads every `.md` under lore/ as lore, this one included (see the sharp edges below).

## What it is

Everything the GM and the people in the story know about the world, kept apart from the scenes ([scenes/](../scenes/)). A scene is about one place and one situation; the lore is the city, its institutions and places, and the people, each in their own words. Who may read a doc is in its frontmatter: a public doc is anyone's, a private doc is only for the people it names, and a gm doc is the GM's own truth. The root is [index.md](index.md), whose "How the lore is kept" and "How the world moves" are the rules for writing it. Why it's written that way is in the authoring guide (authoring.md in [docs/guide/](../docs/guide/)).

## What it owns

| Path | What's in it |
|---|---|
| [index.md](index.md) | The root (gm): the world, the places and the cast, how the lore is kept, and how the world moves |
| [World/](World/index.md) | The city and court: Caerwyn, the royal palace, the King's Road, the City Watch, the Royal Purveyor's office, the grain crisis, the Centennial Assembly. Also [Caerwyn now](World/Caerwyn%20now.md) (public: what anyone could see or hear, hour by hour) and [Fronts](World/Fronts.md) (gm: what's in motion, each front with a clock of steps and the bills still to come due). |
| [Places/](Places/index.md) | The granary yard, the watch house, the market square, the river stairs, the Drowned Rat, the Heron warehouse, the palace kitchens |
| [Cast/](Cast/index.md) | A folder per person: `index.md`; `public.md` (what anyone could know or see of them); `private.md` (who they are, written to them: their lore entry, with `character: <cast id>`); `knowledge/` (what they know or believe of the people and things that matter to them, which can be wrong); `gm.md` (the truth about them) |

A public doc's secrets go in a gm doc beside it, named `<doc> (truth).md`. Besides this README there are 154 docs: 46 public, 84 private and 24 gm. Fourteen people have a lore entry (kell, cob, moll, tull, sallow, king, holt, hobb, nan-quill, arlo, dilly, saul, hep, scrope); the Crake brothers have a folder but no entry.

Memories aren't here. They're written in play, into each game's copy, beside the person's `private.md` (`Cast/<Name>/memories/`).

**Frontmatter** is one key per line, with JSON values:

- `summary`: what the doc covers, in the words a player would use. Disclosure decides whether to open a note from its summary and its link's label, and search reads it too.
- `visibility`: `public`, `private` or `gm`.
- `readers`: on a private doc, who may read it (`["character:kell"]`).
- `type`, and on a `private.md`, `character`: the scene cast id it belongs to.

## How it fits

| Reader | What it reads |
|---|---|
| The docs store ([src/lore/docs.ts](../src/lore/docs.ts)) | Everything: `readDoc` tries a game's copy first, then lore/; `characterEntry` scans the `private.md` files for their `character` ids, once per process |
| Disclosure ([src/lore/disclosure.ts](../src/lore/disclosure.ts)) | Each person's `private.md` and the notes it links to; the scene's `lore` docs for the GM |
| The review agents ([src/lore/reviews.ts](../src/lore/reviews.ts)) | Search, read, edit and create, with their edits in the game's copy |
| The boundary ([src/runtime/engine.ts](../src/runtime/engine.ts)) | `World/Fronts.md` (a scene's `fronts`), in the game's copy |
| Talks ([scenes/talk.ts](../scenes/talk.ts), [src/runtime/talk.ts](../src/runtime/talk.ts)) | A companion's `private.md` (their voice) and `public.md` (their look), their `knowledge/` notes, and `gm.md` (to judge which story is the deepest) |
| Scenes ([scenes/](../scenes/)) | Name docs in their `lore` and `fronts` |
| The fights' AI ([src/game/combat/ai.ts](../src/game/combat/ai.ts)) | Nothing at run time: it's coded from Sallow's and the Crakes' `gm.md`, so a change to how they fight there needs a change there too |
| The static build ([src/web/static/content.ts](../src/web/static/content.ts)) | Every `.md` here, bundled into `content.json` |

## How it works

- **A game's copy.** A read tries `runs/sessions/<id>/docs/<path>`, then `lore/<path>`; a write goes only to the game's copy. So two games never share an edit, and a new game starts from the lore as authored.
- **Access.** The GM reads everything; a person reads public docs and private docs that list them. How each turn's notes are chosen is in [src/lore](../src/lore/).
- **The world moves at scene boundaries.** Each step of a front in `World/Fronts.md` has an "if" or an hour, how it shows, and the scene endings that tick it. At a boundary the model ticks or strikes steps in the game's copy, adds bills, and passes what shows on to the next scene. What anyone could hear goes in `World/Caerwyn now.md`, with who says it.

## Where to look first

- **Every doc's `visibility` and `readers`.** A private doc that names the wrong reader, or loses its `visibility`, is read by the wrong people.
- **`character` ids** on `private.md` must match the scenes' cast ids, and `readers` use `character:<id>`.
- **Summaries are for retrieval.** They decide whether a note is opened, so they name the people, topics and everyday words a player would use.
- **Links** are relative, with spaces as `%20` and brackets as `%28` and `%29`. A public doc's link to its truth says when to read it, never what it says.
- **One home per fact** ([index.md](index.md)): a scene's prose cites the lore rather than restating it.
- **`World/Fronts.md`'s shape is parsed:** a `## ` heading per front, steps as `- [ ] **opening words**`, and a `## Bills still to come due` section ([src/lore/fronts.ts](../src/lore/fronts.ts)).

## How to test it

```sh
node --no-warnings --test src/lore/fronts.test.ts   # moves the authored Fronts.md on, in a test game's copy
grep -rL '^visibility:' lore --include='*.md'       # docs without a visibility: should print nothing
grep -rlZ '^visibility: "private"' lore --include='*.md' | xargs -0 grep -L '^readers:'   # private docs with no readers: nothing
npm run scene -- memories <session>                 # a game's docs as it has them, with their visibility and readers
```

The memory evals ([src/lore](../src/lore/)) test what the lore does in play.

## Known gaps and sharp edges

- **This README is lore to the docs service.** `listDocs` and `searchDocs` take every `.md` under lore/, so the world-facts agent's searches can turn this file up; its frontmatter makes it a gm doc whose summary says it isn't the story's. It's also in the static build's `content.json`.
- **Frontmatter without a `visibility` makes a doc public.** No frontmatter at all makes it gm.
- **The secrets reach the browser.** The static build bundles the whole folder, gm docs included ([src/web/](../src/web/)).
- **The lore and the scenes' cards overlap.** A recurring character's card in each scene restates some of their lore; the two have to agree.
