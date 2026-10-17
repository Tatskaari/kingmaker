import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdtemp,mkdir,readFile,readdir,writeFile,rm,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli=fileURLToPath(new URL('../scripts/import-main-campaign.mjs',import.meta.url));
// Optional source overrides exercise a real checkout/vault through temporary copies only.
const game=process.env.KINGMAKER_IMPORT_TEST_GAME??fileURLToPath(new URL('../../../',import.meta.url));
const examples=process.env.KINGMAKER_IMPORT_TEST_VAULT??fileURLToPath(new URL('../examples/',import.meta.url));
const expectedIds=['caerwyn-afternoon','drowned-rat','wharf-night','heron-warehouse','kings-morning'];
const sourceFiles=['scenes/interludes.ts','scenes/drowned-rat.ts','scenes/heron-warehouse.ts','scenes/kings-morning.ts','scenes/hanged-clerk.ts','scenes/worlds/hanged-clerk.ts','scenes/worlds/drowned-rat.ts','scenes/worlds/heron-warehouse.ts','scenes/worlds/kings-morning.ts'];

async function fixture(t,{copy=true}={}){
  const directory=await mkdtemp(path.join(tmpdir(),'kingmaker-import-cli-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const vault=path.join(directory,'vault');
  await mkdir(vault);
  if(copy)await cp(examples,vault,{recursive:true});
  return {directory,vault};
}
async function tree(directory,prefix=''){
  const result={};
  for(const item of await readdir(directory,{withFileTypes:true})){
    const relative=prefix+item.name;
    if(item.isDirectory())Object.assign(result,await tree(path.join(directory,item.name),relative+'/'));
    else if(item.isFile())result[relative]=await readFile(path.join(directory,item.name),'utf8');
  }
  return result;
}
function invoke(vault,{write=false}={}){
  return spawnSync(process.execPath,[cli,game,vault,...(write?['--write']:[])],{encoding:'utf8',timeout:30000});
}
function run(vault,options){
  const result=invoke(vault,options);
  assert.equal(result.status,0,result.stderr||String(result.error));
  return JSON.parse(result.stdout);
}
const existingScene=(id='drowned-rat',start='the-rat')=>({
  format:'kingmaker',version:1,kind:'scene',id,title:'My edited scene',description:'Author-owned content',
  nodes:[{id:start,type:'story',position:{x:91,y:27},data:{kind:'start',title:'My named input',description:'Keep my edits.',lore:[]}}],edges:[],lore:[],
});
async function put(vault,relative,contents){
  await mkdir(path.dirname(path.join(vault,relative)),{recursive:true});
  await writeFile(path.join(vault,relative),typeof contents==='string'?contents:JSON.stringify(contents));
}

test('CLI dry run changes nothing; write imports only the five authored continuation scenes',async t=>{
  const {vault}=await fixture(t),before=await tree(vault);
  const sourceBefore=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,await readFile(path.join(game,file),'utf8')])));
  const dry=run(vault);
  assert.equal(dry.mode,'dry run');
  assert.deepEqual(dry.scenes.map(scene=>scene.id),expectedIds);
  assert.ok(dry.scenes.every(scene=>scene.status==='new'));
  assert.deepEqual(await tree(vault),before);
  const written=run(vault,{write:true}),after=await tree(vault);
  assert.deepEqual(written.scenes.map(scene=>scene.id),expectedIds);
  const added=Object.keys(after).filter(file=>!(file in before)).sort();
  assert.deepEqual(added,written.scenes.map(scene=>scene.file).sort());
  assert.ok(added.every(file=>file.startsWith('Scenes/')&&file.endsWith('.kmscene')));
  for(const [file,contents] of Object.entries(before))assert.equal(after[file],contents,`${file} was not rewritten`);
  for(const item of written.scenes){
    const document=JSON.parse(after[item.file]);
    assert.equal(document.id,item.id);assert.equal(document.kind,'scene');
    assert.ok(document.nodes.length>1);assert.ok(document.edges.length>0);
    for(const [file,hash] of Object.entries(document.source.fileHashes)){
      const contents=await readFile(path.join(game,file),'utf8');
      assert.equal(hash,createHash('sha256').update(contents).digest('hex'));
    }
    for(const exit of document.nodes.filter(node=>node.data.kind==='exit'&&node.data.file)){
      const target=JSON.parse(after[exit.data.file]);
      assert.ok(target.nodes.some(node=>node.id===exit.data.entry&&(node.data.kind==='start'||node.data.start===true)),`${item.id}/${exit.id} names a real input`);
    }
  }
  for(const [file,contents] of Object.entries(sourceBefore))assert.equal(await readFile(path.join(game,file),'utf8'),contents,`${file} source was not rewritten`);
});

test('CLI reruns preserve edited existing bytes and resolve destinations to an existing scene at its own path',async t=>{
  const {vault}=await fixture(t),kept='Author-owned/My Rat.kmscene';
  const edited=`${JSON.stringify(existingScene(),null,4)}\n\n`;
  await put(vault,kept,edited);
  const before=await tree(vault),first=run(vault,{write:true});
  assert.equal(first.scenes.filter(scene=>scene.status==='new').length,4);
  assert.equal(first.scenes.find(scene=>scene.id==='drowned-rat').file,kept);
  assert.equal(first.scenes.find(scene=>scene.id==='drowned-rat').status,'kept');
  const afternoon=JSON.parse(await readFile(path.join(vault,first.scenes.find(scene=>scene.id==='caerwyn-afternoon').file),'utf8'));
  assert.equal(afternoon.nodes.find(node=>node.data.kind==='exit').data.file,kept);
  const imported=first.scenes.find(scene=>scene.id==='heron-warehouse');
  const changed=JSON.parse(await readFile(path.join(vault,imported.file),'utf8'));
  changed.title='An author-edited warehouse';changed.nodes[0].data.description='Hand-written changes after import.';
  await put(vault,imported.file,changed);
  const beforeRerun=await tree(vault),rerun=run(vault,{write:true});
  assert.ok(rerun.scenes.every(scene=>scene.status==='kept'));
  assert.deepEqual(await tree(vault),beforeRerun);
  for(const [file,contents] of Object.entries(before))assert.equal(beforeRerun[file],contents,`${file} original bytes survive both runs`);
});

test('CLI refuses ambiguous existing IDs before creating any files',async t=>{
  const {vault}=await fixture(t);
  await put(vault,'Scenes/Rat A.kmscene',existingScene());
  await put(vault,'Scenes/Rat B.kmscene',existingScene());
  const before=await tree(vault),result=invoke(vault,{write:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Ambiguous existing scene id/);
  assert.deepEqual(await tree(vault),before);
});

test('CLI refuses an occupied output filename instead of replacing other authored content',async t=>{
  const {vault}=await fixture(t);
  await put(vault,'Scenes/The Drowned Rat.kmscene',existingScene('unrelated-scene'));
  const before=await tree(vault),result=invoke(vault,{write:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Filename already belongs to other content/);
  assert.deepEqual(await tree(vault),before);
});

test('CLI rejects an existing destination without its authored input, without rewriting it',async t=>{
  const {vault}=await fixture(t);
  await put(vault,'Scenes/Changed input.kmscene',existingScene('drowned-rat','new-entry'));
  const before=await tree(vault),result=invoke(vault,{write:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/no longer exposes its authored start/);
  assert.deepEqual(await tree(vault),before);
});

test('CLI preflights output directory collisions before creating the batch',async t=>{
  const {vault}=await fixture(t);
  await mkdir(path.join(vault,'Scenes/The Drowned Rat.kmscene'));
  const before=await tree(vault),result=invoke(vault,{write:true});
  assert.notEqual(result.status,0);
  assert.deepEqual(await tree(vault),before);
});

test('CLI never follows a Scenes directory symlink outside the chosen vault',async t=>{
  const {directory,vault}=await fixture(t,{copy:false});
  const outside=path.join(directory,'outside');await mkdir(outside);
  await symlink(outside,path.join(vault,'Scenes'),'dir');
  const result=invoke(vault,{write:true});
  assert.notEqual(result.status,0);
  assert.deepEqual(await readdir(outside),[]);
});
