# A GM session with a backstory

The prototype's GM calls on the hanged clerk for a player with a backstory, in the format of [../hanged-clerk](../hanged-clerk/) ([the goldens' README](../README.md)), for the AI service's parity: the opening writes the player's doc with the backstory before disclosure, and the GM's brief says who they are from it (v1-design §4.2).

Recorded by `tools/v2/record-v1-golden.mts` from the prototype at `44c6d4a`, under its stand-in for OpenRouter (no model asked). The recorder went with the prototype: it's in git history at `bc2ab1f` (`git show bc2ab1f:tools/v2/record-v1-golden.mts`), where the game was still in `v2/` (`--out v2`):

```sh
KM_RUNS_DIR=$(mktemp -d) OPENROUTER_API_KEY=offline node --no-warnings tools/v2/record-v1-golden.mts \
  --proto /home/jon/git/kingmaker/.claude/worktrees/v2 --out v2
```

Record again only when a case is added: the prototype's code these come from is fixed at `44c6d4a`.

Kell's lore in them carries #661's two edits, put in by hand as for [../hanged-clerk](../README.md#how-they-were-recorded).

| Step | What the player does | The stand-in |
|---|---|---|
| open | `createSession` (Tamsin Vell, the rogue pregen's build, a backstory that passed the lore check, seed 4242) and `openScene` | the GM's opening, with a tagged line |
| t1 | "I look closely at the body." | `attempt: examine-body`: the Medicine check rolls through the rules engine |

The dice: the opening's `comeTo` is the session's first roll (no line: she isn't down), so the check is its second (`rollCount` 2 in t1's settle). The session in each file is as it stood at the step's first call, the rules' campaign left out.

Recording again gives the same calls; the files differ only in the rules engine's random ids for the character and their gear, which no prompt shows.
