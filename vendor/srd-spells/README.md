# The SRD's spell descriptions (vendored)

Part of the [architecture overview](../../ARCHITECTURE.md); the code that reads it is [src/rules](../../src/rules/README.md).

`spells.json` is the description of every spell in the rules engine's starter pack (all 339), in the
words of Wizards of the Coast's **System Reference Document 5.2.1**, keyed by the engine's spell id
(`fire-bolt`). The sheet shows it when a spell on it is picked (`src/rules/spells.ts`).

## Licence and attribution

The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License
(<https://creativecommons.org/licenses/by/4.0/legalcode>). Its own attribution statement, which the
JSON carries as `attribution`:

> This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of
> the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the
> Creative Commons Attribution 4.0 International License, available at
> https://creativecommons.org/licenses/by/4.0/legalcode.

The game shows it at the end of every spell's description (`spellPage` in
`src/app/ui/sheet-layout.ts`). The SRD asks for no other attribution to Wizards of the Coast than
this one, so there isn't any.

## Where the words come from

- **The words:** the official SRD 5.2.1 PDF, `SRD_CC_v5.2.1.pdf` from D&D Beyond
  (<https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf>, SHA-256
  `8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87`). Its spell chapter is word for
  word the same as the original SRD 5.2's (`SRD_CC_v5.2.pdf` from the same place, SHA-256
  `cf18e1f88a360646940b6fada63fd1bd04c1c02581ca668a9115c2f4577bf8aa`: 51,751 words each, no
  differences; `--srd52` compares them), so this is SRD 5.2's spell text too.
- **The layout:** a PDF's text comes out a line at a time, so where the paragraphs break, the lists,
  the tables and the italics come from a Markdown conversion of the same SRD 5.2.1,
  [greghcarr/dnd-5e-srd-markdown](https://github.com/greghcarr/dnd-5e-srd-markdown) (CC BY 4.0;
  `spells.md` at commit `1b4b99d`, SHA-256
  `3431f5b8f50fdb0c65cdf98f0164301c8757d20983d32b5ae9b5be7dc634bffb`). It's the SRD reference the
  rules engine's author keeps (`vendor/dnd-srd-engine/NOTICE`, section 3).
- **The check:** every spell against its own text in the PDF, both ways, by letters and digits
  (spacing, punctuation and line breaks aside): each paragraph, list item, heading, caption and table
  cell is in it, in order, and nothing in it is left out. Each spell's level, school and classes
  match the pack's. Where the two sources differ, the PDF's words are the ones kept; the build stops
  on anything else.

## Changes from the SRD

- Laid out as data: a paragraph is a string, `{"item"}` a list item, `{"heading"}` a heading in a
  stat block (a creature a spell summons), `{"table", "head", "caption"}` a table. The SRD's
  emphasis is kept as `_italic_` and `**bold**`. Header lines are as the SRD prints them
  (`castingTime` with a reaction's trigger), with the apostrophes and quotes straight.
- *Telekinesis:* the PDF's paragraph on fine control stops at a comma ("…such as manipulating a
  simple tool,"); the rest of the sentence isn't in SRD 5.2 or 5.2.1. It's kept as the SRD has it,
  with an ellipsis to show the cut.
- A stat block's ability table has its MOD and SAVE headings over the right columns.

The game's own rules for a spell (its level, casting time, range, components, duration and what it
does) are the engine's (`vendor/dnd-srd-engine/starter-pack.json`); this text is what the SRD says
about it, shown beside them. A few header lines differ from the pack's (Barkskin, Find Steed and
Prayer of Healing's casting times, for instance): the game plays the pack's.

## Rebuilding

```sh
python3 tools/srd-spells/build.py          # downloads both sources, checks their SHA-256, checks every spell, writes spells.json
python3 tools/srd-spells/build.py --check  # the same, writing nothing
python3 tools/srd-spells/build.py --srd52 SRD_CC_v5.2.pdf   # and compares the spell chapter with SRD 5.2's
```

It needs `pdftotext` (poppler-utils).
