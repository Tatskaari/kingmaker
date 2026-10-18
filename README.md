# Kingmaker

**A cRPG where you can truly do what you want.** Hand-written stories, run by an AI game master, in a world that remembers what you did.

You make a character from a sentence, walk the town of Caerwyn on an animated ASCII map, and play its scenes in plain English. The GM improvises around each scene's prep and gets the plot back on track when you go off it. The D&D 5.5e rules handle anything that takes dice, and whatever the story says happened is what the world keeps. A campaign is a folder of Markdown and scene files you write in Obsidian, kept separate from the engine so other people can write for it.

**[Play it in your browser →](https://tatskaari.github.io/kingmaker/play/)** (bring an OpenRouter key, or pick the fake GM to try it for free) · [The pitch](https://tatskaari.github.io/kingmaker/) · [The roadmap](https://tatskaari.github.io/kingmaker/roadmap/)

## Run it

You need Node (the repo's `.prototools` pins the version), the [SpacetimeDB CLI](https://spacetimedb.com/install) 2.12.0 and `pasta` (from the passt package). Real models also need an OpenRouter key in `OPENROUTER_API_KEY`.

```sh
npm ci
npm run dev -- --fake              # the stack on the fake GM: no key, no cost (drop --fake for real models)
npm run client -- --session me     # in another terminal: play in the terminal
```

Or in a browser, with no server at all:

```sh
npm run build:web && npm run web:serve   # then open the address it prints
```

`npm run glyphs` installs the font the terminal draws people and creatures with, and `npm run check` runs the type check and the tests.

## More

- [docs/running.md](docs/running.md): everything you can play, the stack's flags and keys, headless play for agents, the browser build, the checks and the repo's rules
- [ARCHITECTURE.md](ARCHITECTURE.md): how the parts fit together, the place to start a review
- [tools/authoring/](tools/authoring/README.md): the Obsidian plugin for writing scenes, maps and places
