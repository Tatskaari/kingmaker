# Agent Disclosure

The vault separates character-private knowledge from GM-only truth. The lore access tests follow every note link from every scenario character entry and reject inaccessible, broken, ambiguous or invalid references. The same access rules gate runtime retrieval before documents are offered to Jev or loaded into character context.

## Write to the reader

Write private characterization and scenario character notes directly to the character: “you want”, “you know” or “you believe”. Keep voice guidance actionable and examples clearly illustrative. Observer knowledge describes that observer's understanding, not unrestricted truth about the subject. Leave unwritten bodies as literal stubs.

Write GM notes to the GM, distinguishing established truth, possible outcomes, disclosure conditions and unresolved author decisions. Setting and plot reference notes are GM-only unless deliberately scoped for characters. Keep source archives and author navigation addressed to the author. Do not copy editorial provenance or unknown truths into character-facing notes.

## Initial context
The GM begins at the scenario's `scenario.md` and can consult the full authored vault. A conversation begins at its own `Characters/<id>/character.md`, which links to its private cast note and scoped scenario detail. Retrieve permitted detail when relevant; do not recursively load the graph into a prompt.

## Document summaries for Jev

Use a flat `summary` Text property for a one- or two-sentence description of an authored note's contents. Name the people, everyday topics and kinds of detail it covers: “the Nine Furrows wizards and their magical specialties” is more discoverable than an institution name alone. Summarize only material actually in the note; do not add facts solely to a preview.

```yaml
summary: "The three Nine Furrows wizards, their magical specialties and links to their public profiles."
```

When Jev considers an unopened linked note, its summary appears above the path in that note's opening criterion and in the CLI's link decision details. Both vault and saved-world loaders check the note's read permission first. The summary inherits the entire note's audience and never grants access or opens the note by itself.

Summaries help choose what to retrieve; the character receives the full body only after the note is opened. Missing summaries remain supported, but supplied summaries must be nonempty text. Leave unwritten stubs alone rather than inventing a preview of unauthored material. Updated summaries in saved documents are used on the next disclosure pass; start a fresh game to take updated baseline vault summaries into an existing saved-world workflow.

## Cast audiences
Each cast member has a folder under `Cast/<faction>/<name>/`:

- `public.md`: a concise profile of publicly understood roles and expertise, written to an informed observer. Assembly delegates grant `court-informed` readers access; the filename alone does not make a note universally visible. Keep secrets, private motives, author references and links to private dossiers out of these profiles.
- `private.md`: the character's identity, voice, motives and self-knowledge, explicitly private to that character ID.
- `gm.md`: unknown truths about the person, source references, editorial uncertainty and GM guidance. Always GM-only.
- `knowledge/<other cast member>.md`: the observing character's knowledge or beliefs about that person. Each note is private to the observer, not the subject. Relationships need not be symmetrical and beliefs need not be true.
- `index.md` and `knowledge/index.md`: author navigation, never implicit character context.

Every cast member has a knowledge note for every other member. Unwritten bodies remain “This is a stub.” beneath access metadata; an empty entry establishes no familiarity. Carry only established knowledge into these notes. Preserve facts with uncertain recipients in GM material rather than assuming everyone involved knows them. Tomas's parentage, for example, belongs in his GM note, not his self-knowledge.

Private notes link directly to their owner's knowledge notes. They must not link to another person's private dossier, a GM note, an author index or a source issue. Keep author provenance in GM notes. A note about a faction is not automatically safe for all its members.

## Scenario detail
Scenario-local notes place the reusable person at a particular time and location:

- `background.md`: scoped history, relationships and world understanding.
- `situation.md`: starting knowledge, beliefs, objectives and disclosure conditions.
- `conversation.md`: permitted dialogue beats and improvisation boundaries.

The current scenario detail stubs retain their literal text. Non-index notes inside the starting character's scenario folder have implicit access for that character only; explicit metadata overrides this convention. Other scenario character folders receive no implicit grant. Stable characterization remains in the private cast note, not duplicated into scenario files.

## Access metadata
Use YAML frontmatter with `visibility: public`, `visibility: private` or `visibility: gm`. Private notes use a flat `readers` list of prefixed IDs: `character:aldren`, `faction:caerwyn` or `label:court-informed`. Any matching entry grants access. The tests include labels from the character entry, without implicit faction or playthrough grants. Missing metadata defaults to GM-only except for the scoped scenario convention above. Invalid metadata never grants access.

```yaml
---
visibility: private
readers: ["character:aldren"]
---
```

The flat list works with [Obsidian's list properties](https://obsidian.md/help/properties); nested properties are not supported by its property editor. Inline and block YAML lists are equivalent:

```yaml
readers:
  - "character:aldren"
  - "label:court-informed"
```

Prefixes and IDs match exactly. IDs must be nonempty, with no whitespace or additional colons. Unknown prefixes, malformed values and the former nested reader mapping fail closed. Use a fresh game for saved documents containing the old metadata; no compatibility conversion is provided.

A grant covers an entire note. Split mixed audiences into separate notes. Markdown links, embeds, aliases and prose labels do not grant access or exempt a reference from checking. Author indexes may link to all audiences because they are not character entrypoints.

## Labels and shared court knowledge

Documents can carry a YAML `labels` list. On a scenario's `character.md`, it defines that character's audience labels. Other documents' labels classify those documents but never give the reader more permissions. Labels are exact, case-sensitive IDs; malformed lists fail closed.

Each Centennial Assembly character entry has `labels: [court-informed]`. This means they know the shared baseline in `court_briefing.md` and its delegation overviews, which link to each delegate’s public profile. It does not imply personal acquaintance, private motives or knowledge of events that have not happened. Offstage cast members do not inherit this scenario grant.

Shared documents explicitly grant that audience access:

```yaml
---
visibility: private
readers: ["label:court-informed"]
---
```

A document's own `labels` do not grant access to it; matching `label:<id>` entries in `readers` do. GM-only visibility overrides every grant. Keep links from the briefing within the permitted graph, and keep author provenance and private dossiers outside it. Link the briefing from both character entrypoints (for Jev) and navigation indexes (for authors). Runtime disclosure opens relevant links progressively, rather than loading all shared knowledge at conversation start. Saved document state retains this metadata; changing incompatible baseline lore requires a fresh game.

## Discoveries during play
The GM adjudicates actions, quest transitions and discoveries using the full scenario. Send resulting observations only to the recipients who actually learn them. A completed milestone does not automatically teach every character its secrets. Keep these recipient-specific playthrough grants separate from baseline Markdown; they never reveal GM-only branches or apply world-state changes through dialogue.

Runtime loaders enforce permissions before initial prompts, candidate links and retrieval. The passing authoring test does not establish who knows an unlabelled fact inside an otherwise permitted note.

Parent: [[Authoring/index|Authoring]].
