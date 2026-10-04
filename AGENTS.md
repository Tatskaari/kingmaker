# World-state ownership

Never clone the world. Do not deep-copy a WorldState with protobuf clone, structuredClone, JSON round-trips, or equivalent helpers. Read the live world and stage only the specific documents, inventories or actors an operation changes. Validate before publishing those changes. Build fresh worlds from source fixtures when isolation is required; serialization is for explicit save/export boundaries, not a substitute for cloning during updates.

# Repository workflow

Use the official GitHub Stacks CLI extension for related pull requests. Keep each layer independently reviewable and make every branch target the branch directly below it.

Treat requests to implement, change, or fix repository code as requests to complete the delivery workflow: make the change, commit it, push it, and open or update the pull request unless the user explicitly asks for local-only work or no PR. Use one layer for a small cohesive change. For sizeable work, split the review into the smallest coherent stack layers practical, aiming for roughly 100–200 changed lines per PR while preserving buildable, independently reviewable layers.

Push the first coherent, reviewable commit and open its PR early, before running lengthy local tests or builds. The user's GitHub Action provides QA, so publish and share the PR link while local validation continues. Mark validation as pending or in progress until results are known; keep pushing coherent follow-up commits and updating PR descriptions as fixes and feedback land. Early publication does not replace the required checks or mean the work is complete.

## Worktrees

Perform implementation work in a dedicated Git worktree for the task, not in the shared primary checkout. Create or use the task's worktree before editing files or switching implementation branches. Run stack commands, commits, and checks from that worktree. Leave unrelated worktrees and their changes untouched.

When moving an existing task into a worktree, preserve its uncommitted changes with a stash and commit them on its feature branch before handoff. An unfinished checkpoint commit is allowed for this transfer; record any outstanding validation and continue it after the move.

### Lore collaboration exception

Collaborate on lore and the Obsidian vault directly in `~/git/kingmaker`, with the vault at `~/git/kingmaker/lore`, so the user's Obsidian setup has a stable path. This is an explicit exception to the dedicated-worktree rule for lore authoring. Run lore edits, commits, checks and stack commands from that checkout. Before moving a lore branch there, commit the task's changes, release the branch from its current worktree, and check it out in `~/git/kingmaker` without overwriting unrelated changes. Preserve the user's in-progress Obsidian edits. Continue using dedicated worktrees for game-code implementation.

Before collaborating on lore, read [Working on Lore](lore/Authoring/Working%20on%20Lore.md) and [Agent Disclosure](lore/Authoring/Agent%20Disclosure.md). Follow the author-led sketching workflow and preserve the distinction between reusable character lore, scenario context and each in-game agent's permitted knowledge.

Keep static characterization—including biography, speech style, mannerisms, enduring motives and relationships—in `lore/Cast/<faction>/<name>/private.md`. Keep unknown truths, source references and author-only guidance in `gm.md`; put each character’s knowledge or beliefs about another cast member in their own `knowledge/<other name>.md`, private to the observer. Keep a knowledge entry for every other cast member, leaving unwritten bodies as stubs beneath access metadata. Scenario character notes place that person at a particular time and location with current objectives, knowledge and temporary circumstances; link to the private cast entry rather than authoring a second personality or voice. Character-facing links must remain within that character’s permitted graph; run the lore access tests as part of repository checks.

Use flat YAML list properties for lore permissions: `readers: ["character:aldren", "label:court-informed"]`, with `character:`, `faction:` or `label:` prefixes. Never author nested reader mappings. Put audience membership in the scenario character entry’s `labels: [court-informed]`; put `readers: ["label:court-informed"]` on shared notes. Declare faction membership with a flat `factions` list on scenario character entries and use `faction:<id>` in shared-note readers. Keep conflicting beliefs in separate notes with the correct readers; do not replace a character’s belief with unrestricted GM truth. Keep `visibility: private` for scoped grants and `visibility: gm` for GM-only truth. Follow the examples in `lore/Authoring/Agent Disclosure.md` and `lore/Authoring/Authoring Guide.md`.

Give every lore Markdown document, including indexes, author references and stubs, a flat `summary` Text property describing its contents in one or two sentences, with ordinary topic words as well as names. Keep the summary faithful to the body and appropriate to its audience. Stub summaries must explicitly say the content is unwritten; preserve their literal “This is a stub.” bodies. Jev sees permitted summaries before choosing which linked documents to open.

For lore navigation, every content folder under `lore/` (including the vault root) must have a lowercase `index.md`. Keep its note links, child-folder index links and parent link current when adding, moving or renaming content. Use unambiguous vault-relative links for nested indexes and relative Markdown links to the root index. These are author navigation files; retain `scenario.md` and `character.md` as agent entrypoints.

## Saved-game compatibility

Do not add or maintain migrations or backward-compatibility code for existing saved games. When save schemas or authored world content change incompatibly, require a fresh game instead of upgrading old saves. Keep ordinary save/load support for the current format.

## Development credentials

The local OpenRouter development key is stored as a plain key in `~/secrets/kingmaker-dev-openrouter.txt`. Never copy or commit it to the repository. To pre-populate the key in the browser while running the local dev server, use `KINGMAKER_USE_DEV_OPENROUTER_KEY=1 npm run dev`. The flag is intentionally ignored by production builds.

## Create and submit a stack

1. Update `main` from `origin/main` and begin from a clean working tree.
2. Start the bottom layer with `gh stack init <branch>`.
3. Implement and commit the first coherent, reviewable version of that layer.
4. Immediately publish it with `gh stack submit --auto --open`, before lengthy local validation. Replace generated PR bodies with concise problem, resulting behavior, validation status, actionable QA criteria, and stack-order details using `gh pr edit <number> --body-file <file>`. Mark checks not yet run as pending and share the PR link with the user.
5. Add each dependent layer with `gh stack add <branch>`, then implement, commit and submit it as soon as it is reviewable; do not wait for the entire stack to be finished before publishing.
6. Run `proto run moon -- run workspace:check workspace:build` from the top branch while GitHub QA and the user's review can proceed.
7. Fix any failures, commit and submit follow-up changes, and re-run affected checks. Refresh PR descriptions with actual validation results and current QA criteria.
8. Verify the stack with `gh stack view` and confirm each PR's base and head using `gh pr view` before reporting completion.

## PR QA criteria

Every PR description must include a QA checklist a reviewer can follow. Explain what the change adds or changes, name the page, screen, panel or other surface where it can be observed, and give concrete actions with expected results. Include necessary setup such as a fresh game, credentials, fixtures or the dependent stack layer needed to expose the behavior. For example: “On the New game screen, choose Play a pre-made character; expect three character choices and a Back button.”

For backend or tooling changes without a visible UI, say so and provide a specific command, test or log/artifact to inspect, with the expected result. Distinguish behavior available in this layer from behavior that requires a later layer. State any model-dependent or failure-injection prerequisites rather than implying a prompt reliably triggers them. Keep proposed QA steps separate from validation already performed; never imply an unchecked step has passed. Refresh the checklist when updating the PR's scope.

## Change a lower layer

1. Move down with `gh stack down` or check out the required stack branch.
2. Amend or commit the lower-layer change.
3. Run `gh stack rebase --upstack --no-trunk` to cascade it through dependent branches.
4. Resolve conflicts by retaining the intended behavior from both layers, stage the resolution, and run `gh stack rebase --continue`.
5. Publish the rewritten stack with `gh stack submit --auto --open` before lengthy local validation and refresh affected PR descriptions, marking checks as pending or in progress.
6. Re-run the full checks from the top branch while GitHub QA proceeds. Fix and publish any follow-up changes, re-run affected checks, and update the PR descriptions with actual results before reporting completion.

## After merge

Fetch and fast-forward local `main` from `origin/main`. Do not keep adding commits to branches whose PRs are already merged; start a fresh stack for follow-up work.
