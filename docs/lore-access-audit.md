# Lore access tests

The normal `npm test` and `npm run check` workflows audit every scenario character
entry under `lore/Scenarios/`. Run only the lore tests with:

```sh
node --import tsx --test tests/lore-access.test.ts tests/lore-vault.test.ts
```

The audit follows every reachable Markdown note, including links beyond denied
notes, and fails on denied, broken, ambiguous or invalid references. Failures
show a chain from the scenario entry to the problem. Cycles are visited once;
when several paths reach a note, the first shortest chain is reported. The vault
test also checks that every cast member has private characterization, a GM note
and observer-owned knowledge notes for every other cast member.

## Permissions

Notes use YAML frontmatter:

```yaml
---
visibility: private
readers: ["character:aldren"]
---
```

- `public` grants every character access.
- `private` grants any matching `character:<id>`, `faction:<id>` or `label:<id>` in the flat `readers` list.
- `gm` never grants a conversation character access.

IDs match exactly, including their prefix. Reader IDs must be nonempty and contain no whitespace or additional colons. Both inline and block YAML lists are accepted. Nested reader mappings, unknown prefixes and malformed entries fail closed, even alongside a valid grant. Unclassified notes default to GM-only, except non-index notes
inside the starting character's scenario folder. Explicit metadata overrides
that convention, including on the entry itself. Cast private and knowledge notes
explicitly name their owner; knowledge belongs to the observer, not the subject.
Author indexes receive no implicit access. Invalid metadata is a test failure.

The committed-vault tests include labels from each character entry, without implicit faction or
playthrough grants. The audit helper accepts trusted `factions` and exact
vault-relative `grants` for testing future integrations. A grant can unlock a
private note but never GM-only material; it does not propagate through links.
Milestones must grant access to the recipients who actually learned something.
The audit does not evaluate story events or write game state.

The flat list is the only supported reader format. Start a fresh game for saves
containing the former nested metadata; no saved-game conversion is provided.

## Authoring

Each cast folder contains `private.md`, `gm.md` and `knowledge/<other name>.md`.
Scenario entries link directly to the private note. Keep sources, unknown truths
and editorial uncertainty in GM notes; do not link these from private context.
Author indexes provide full navigation outside the character graph. Missing
knowledge remains a literal “This is a stub.” body beneath its access metadata.
A whole file has one audience: split mixed audiences instead of granting access
to a file containing secrets. See the vault's `Authoring/Agent Disclosure.md`.

Supported links include Obsidian wikilinks and embeds, aliases, heading/block
suffixes, inline Markdown links, reference links and Markdown note embeds.
Markdown paths are relative to their source (leading `/` means vault root).
Wikilinks prefer an exact vault path, then a source-relative path, then a unique
suffix match. Ambiguous shorthand fails instead of selecting an arbitrary note.
Heading and block existence are not checked because permissions cover the file.
External URLs, non-Markdown Markdown-link attachments, code and HTML are ignored.
Use Markdown or wikilinks for auditable note references. Hidden folders and
symbolic links are excluded; outside-vault paths are never read.

This is a read-only authoring test, not a semantic check of which facts a character knows.
The runtime loaders use the same permissions before building prompts or returning candidate links and documents. Test output may
name private or GM resources and must not itself become character context.
