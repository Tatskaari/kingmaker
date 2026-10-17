# The SRD's spell descriptions (vendored)

`spells.json` is every spell in the rules engine's starter pack (all 339) in the words of Wizards of
the Coast's **System Reference Document 5.2.1**, keyed by the engine's spell id (`fire-bolt`). The
sheet shows a spell's words when it's picked on the sheet (`shared/rules/spells.ts` reads it, handed
the file by its host).

It's the prototype's `vendor/srd-spells/spells.json` at `44c6d4a`, byte for byte (sha256
`4394738ae84b012989b0ceb054874d9b0be41b1729f46e04e29174ed037aea48`), copied by
`tools/v2/module-engine.mts`. How its words were taken from the SRD, and checked against it, is in
the prototype's [vendor/srd-spells/README.md](../../../vendor/srd-spells/README.md); it's rebuilt
there, by `tools/srd-spells/build.py`, never here.

## Licence and attribution

The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License
(<https://creativecommons.org/licenses/by/4.0/legalcode>). Its own attribution statement, which the
JSON carries as `attribution`, and which the game shows at the end of every spell's words:

> This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of
> the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the
> Creative Commons Attribution 4.0 International License, available at
> https://creativecommons.org/licenses/by/4.0/legalcode.
