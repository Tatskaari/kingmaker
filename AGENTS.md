# Repository workflow

Use the official GitHub Stacks CLI extension for related pull requests. Keep each layer independently reviewable and make every branch target the branch directly below it.

Treat requests to implement, change, or fix repository code as requests to complete the delivery workflow: make the change, commit it, push it, and open or update the pull request unless the user explicitly asks for local-only work or no PR. Use one layer for a small cohesive change. For sizeable work, split the review into the smallest coherent stack layers practical, aiming for roughly 100–200 changed lines per PR while preserving buildable, independently reviewable layers.

## Worktrees

Perform implementation work in a dedicated Git worktree for the task, not in the shared primary checkout. Create or use the task's worktree before editing files or switching implementation branches. Run stack commands, commits, and checks from that worktree. Leave unrelated worktrees and their changes untouched.

When moving an existing task into a worktree, preserve its uncommitted changes with a stash and commit them on its feature branch before handoff. An unfinished checkpoint commit is allowed for this transfer; record any outstanding validation and continue it after the move.

### Lore collaboration exception

Collaborate on lore and the Obsidian vault directly in `~/git/kingmaker`, with the vault at `~/git/kingmaker/lore`, so the user's Obsidian setup has a stable path. This is an explicit exception to the dedicated-worktree rule for lore authoring. Run lore edits, commits, checks and stack commands from that checkout. Before moving a lore branch there, commit the task's changes, release the branch from its current worktree, and check it out in `~/git/kingmaker` without overwriting unrelated changes. Preserve the user's in-progress Obsidian edits. Continue using dedicated worktrees for game-code implementation.

## Saved-game compatibility

Do not add or maintain migrations or backward-compatibility code for existing saved games. When save schemas or authored world content change incompatibly, require a fresh game instead of upgrading old saves. Keep ordinary save/load support for the current format.

## Development credentials

The local OpenRouter development key is stored as a plain key in `~/secrets/kingmaker-dev-openrouter.txt`. Never copy or commit it to the repository. To pre-populate the key in the browser while running the local dev server, use `KINGMAKER_USE_DEV_OPENROUTER_KEY=1 npm run dev`. The flag is intentionally ignored by production builds.

## Create and submit a stack

1. Update `main` from `origin/main` and begin from a clean working tree.
2. Start the bottom layer with `gh stack init <branch>`.
3. Implement and commit that layer.
4. Add each dependent layer with `gh stack add <branch>`, then implement and commit it.
5. Run `proto run moon -- run workspace:check workspace:build` from the top branch.
6. Submit or update the complete stack with `gh stack submit --auto --open`.
7. Replace generated PR bodies with concise problem, resulting behavior, validation, and stack-order details. Use `gh pr edit <number> --body-file <file>`.
8. Verify the stack with `gh stack view` and confirm each PR's base and head using `gh pr view`.

## Change a lower layer

1. Move down with `gh stack down` or check out the required stack branch.
2. Amend or commit the lower-layer change.
3. Run `gh stack rebase --upstack --no-trunk` to cascade it through dependent branches.
4. Resolve conflicts by retaining the intended behavior from both layers, stage the resolution, and run `gh stack rebase --continue`.
5. Re-run the full checks from the top branch.
6. Publish the rewritten stack with `gh stack submit --auto --open` and refresh affected PR descriptions.

## After merge

Fetch and fast-forward local `main` from `origin/main`. Do not keep adding commits to branches whose PRs are already merged; start a fresh stack for follow-up work.
