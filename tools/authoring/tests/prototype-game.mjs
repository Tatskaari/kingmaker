// The game the importer's tests read: the retired prototype, whose TypeScript scenes the importer
// converts. KINGMAKER_IMPORT_TEST_GAME (or KINGMAKER_MAIN_REPO) names a checkout that has them;
// otherwise they're the prototype as it was at its last commit here, bc2ab1f (docs/migration-log.md),
// taken out of this repo's history into a folder of its own and committed there, since the importer
// asks git for its revision. Nothing in this repo is touched: git archive only reads.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** The prototype's last commit, before M1 deleted it. */
export const PROTOTYPE='bc2ab1f';
const REPO=fileURLToPath(new URL('../../../',import.meta.url));

/** A checkout with the prototype's scenes/, lore/ and package.json, and how to be rid of it (a named checkout is left alone). */
export function prototypeGame(named=process.env.KINGMAKER_IMPORT_TEST_GAME){
  if(named)return {game:named,done(){}};
  let tar;
  try{tar=execFileSync('git',['-C',REPO,'archive','--format=tar',PROTOTYPE,'scenes','lore','package.json'],{maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe']})}
  catch(error){throw Error(`The prototype's scenes come from git history at ${PROTOTYPE}, which this clone hasn't got (${String(error.stderr||error.message).trim()}): fetch it, or set KINGMAKER_IMPORT_TEST_GAME to a checkout that has scenes/.`)}
  const game=mkdtempSync(path.join(tmpdir(),'kingmaker-prototype-'));
  execFileSync('tar',['-x','-f','-','-C',game],{input:tar});
  const git=(...args)=>execFileSync('git',['-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','-c','user.name=Kingmaker tests','-c','user.email=tests@kingmaker.invalid',...args],{cwd:game,stdio:['ignore','pipe','pipe']});
  git('init','-q');git('add','-A');git('commit','-q','-m',`The prototype's scenes and lore at ${PROTOTYPE}`);
  return {game,done(){rmSync(game,{recursive:true,force:true})}};
}
