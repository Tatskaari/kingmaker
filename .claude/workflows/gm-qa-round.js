export const meta = {
  name: 'gm-qa-round',
  description: 'Blind GM QA round on the game: a persona tester plays each game of a loop round on its dev stack, then a blind reviewer judges it by the rubric',
  whenToUse: 'Steps 1 and 2 of the kingmaker-gm-loop skill, once `npm run loop -- round` has made the round and its stack is up. args: { round, games: ["g01", ...], loopDir?, testerModel?, reviewerModel? }',
  phases: [
    { title: 'Play', detail: 'one blind tester per game: loop brief, then start and say' },
    { title: 'Review', detail: 'one blind reviewer per game, as soon as it is played: review-pack, the review, review-check' },
  ],
}

// After the prototype loop's .claude/workflows/gm-qa-round.js at 5f01806 (origin/claude/gm-loop, draft PR #663), for the game: a
// game's start makes its character and takes the story to its scene (a minute or two), and a turn can wait on a busy model, so the
// testers give each command five minutes.
// args: { round: "r1-1018", games: ["g01", "g02"], loopDir?: "<KM_LOOP_DIR, unset in a worktree>" }
const round = args && args.round
const games = (args && args.games) || []
if (!round || !games.length) throw new Error('args: { round, games: ["g01", ...], loopDir? }')
const loop = (args.loopDir ? `KM_LOOP_DIR=${args.loopDir} ` : '') + 'npm run -s loop --'

const PLAYED = {
  type: 'object',
  required: ['turns', 'ended', 'notes', 'problems'],
  properties: {
    turns: { type: 'integer', description: 'turns you took' },
    ended: { type: 'string', description: "how the scene ended, in the game's words, or 'out of turns' / 'stopped'" },
    notes: { type: 'string', description: 'the path you wrote your notes to' },
    problems: { type: 'string', description: "commands that failed or anything that stopped play; '' if none" },
  },
}
const REVIEWED = {
  type: 'object',
  required: ['findings', 'overall', 'checked'],
  properties: {
    findings: { type: 'integer' },
    overall: { type: 'integer', description: 'your overall rating, 1 to 5' },
    checked: { type: 'boolean', description: 'review-check passed on your file' },
  },
}

const tester = game => `You are a blind playtester for a text roleplaying game. Get your brief by running this command in the repository you're in:

    ${loop} brief ${round} ${game}

Then do exactly what the brief says: start the game, play the scene in character with the commands it gives (one turn per command), stop when the game says the scene is over or you're out of turns, and write your notes where it says. Starting can take a minute or two and a turn up to a couple of minutes when the game is busy, so run each command with a timeout of five minutes. Don't read the game's code, prompts, campaign, scenes, lore or other runs: you're a player, and the test is blind. Report the turns you took, how the scene ended, your notes' path, and any command that failed.`

const reviewer = game => `You are a blind reviewer of an AI game master's play. Make your review pack by running this command in the repository you're in:

    ${loop} review-pack ${round} ${game}

It prints the pack's path. Read the whole pack: it has your instructions, the rubric, the truth behind the screen and the scene as the player saw it. Follow the instructions exactly: write the review JSON where the pack says, then run the review-check command it gives and fix your file until it passes. Read nothing but the pack (no code, prompts, campaign, other games or notes): the review is blind. Report your number of findings, your overall rating and whether review-check passed.`

const results = await pipeline(
  games,
  game => agent(tester(game), { label: `play:${game}`, phase: 'Play', schema: PLAYED, ...(args.testerModel ? { model: args.testerModel } : {}) }),
  (played, game) => agent(reviewer(game), { label: `review:${game}`, phase: 'Review', schema: REVIEWED, ...(args.reviewerModel ? { model: args.reviewerModel } : {}) })
    .then(review => ({ played, review })),
)

const out = games.map((game, i) => ({ game, ...(results[i] || { played: null, review: null }) }))
const failed = out.filter(r => !r.played || !r.review || !r.review.checked)
if (failed.length) log(`${failed.length} game(s) need a look: ${failed.map(r => r.game).join(', ')}`)
return { round, games: out }
