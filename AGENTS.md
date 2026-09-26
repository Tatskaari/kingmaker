# Repository workflow

Use the official GitHub Stacks CLI extension for related pull requests. Keep each layer independently reviewable and make every branch target the branch directly below it.

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
