# v2: the production build

The production build of Kingmaker, as the design has it: a client, a simulation and a stateless AI service.

- **The client** is the prototype's OpenTUI app, in a terminal or a browser tab. It talks only to the simulation.
- **The simulation** is a SpacetimeDB module (run locally with the `spacetime` CLI), the authority on everything that happens: the moves, the rules, the world, every die.
- **The AI API** (`kingmaker-ai`) is an HTTP service that does all the model work and keeps the words: the prompts, the lore and each game's documents. It holds nothing between requests, since each one carries the working set it needs, so it runs as a local process or a container for now, and on Cloud Run or as a Lambda later. It's the only part that calls OpenRouter.

The design is the roadmap ([src/web/site/roadmap](../src/web/site/roadmap/index.html), published with each PR preview at `roadmap/`). It's built a vertical at a time: a slice of the game end to end through the parts, with the prototype ([ARCHITECTURE.md](../ARCHITECTURE.md)) playable throughout.

| Folder | What it is |
|---|---|
| [ai/](ai/README.md) | The AI API's first part: the model client, the prompts and the docs service. The prototype runs this same copy, so a change here is a change to both. |

More folders come with each vertical. v2 doesn't import the prototype: what it needs of it is copied. v2/ai is the one place they share, and there the prototype imports v2.
