import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {convertScene} from '../scripts/main-scene-conversion.mjs';
import {prototypeGame} from './prototype-game.mjs';

const output=await build({entryPoints:[new URL('../src/model.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {parseDocument,serializeDocument,entryPorts}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const inert=value=>JSON.parse(JSON.stringify(value,(_key,item)=>typeof item==='function'?Function.prototype.toString.call(item):item));
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child)}return value};

function fixture(){
  let executions=0;
  const script=(world,outcome)=>{executions++;throw Error('The converter must never run an exit script');};
  const scene={
    id:'fixture-scene',title:'The Fixture Scene',summary:'A complete authored fixture.',
    setting:'The rain-soaked yard.',premise:'Who will tell the truth?',hook:'A page needs finding.',opening:'The witness waits.',
    limits:['No invented help.'],background:['A prior clue was found.'],fronts:'World/Fronts.md',time:'evening',rest:'short',milestone:true,
    cast:[{id:'known',name:'Existing Person',look:'A red coat.',voice:'Dry.',wants:'A true record.',fears:'A false charge.',knows:['The gate was locked.'],secrets:['I have the key.'],attitude:'wary',enters:'clue',statblock:'guard',weapon:'club'},
      {id:'missing',name:'Missing Person',look:'A shadow.',voice:'Quiet.',wants:'To leave.',knows:[],attitude:'neutral'}],
    start:'yard',
    beats:[
      {id:'yard',title:'The yard',direction:'Find the page.',cast:{known:'Watch their hands.'},pressure:'The bell tolls.',customBeat:{preserved:true},transitions:[
        {id:'look',when:'The page is noticed.',to:'clue',establishes:['noticed'],given:true,towards:'page'},
        {id:'ask',when:'A difficult appeal.',essential:'page',establishes:['asked'],check:{skill:'persuasion',dc:12,reason:'to earn trust',success:'They hand over the page.',failure:'They hold it tighter.',onSuccess:'clue',establishes:{success:['page-found'],failure:['rebuffed']}}},
        {id:'deadline',on:'cue',when:'The bell rings.',check:{skill:'insight',dc:14,success:'The signal is read.',failure:'The chance is gone.',onSuccess:'won',onFailure:'lost'}},
      ]},
      {id:'clue',title:'The clue',direction:'Read what was found.',cast:{known:'Wait for the question.'},pressure:'A cart arrives.',transitions:[{id:'pause',when:'The player pauses.'}]},
    ],
    anytime:[{id:'give-up',when:'The player leaves.',to:'lost'},{id:'final-appeal',on:'attempt',when:'One final appeal.',check:{skill:'persuasion',dc:15,success:'It works.',failure:'They refuse.',onSuccess:'won',onFailure:'lost'}}],
    exits:[{id:'won',kind:'progress',title:'A true record',outcome:'The truth is recorded.',closing:'Close on the signed page.',next:'known-next',script,extraExit:{preserved:true}},
      {id:'lost',kind:'other',title:'The chance is gone',outcome:'The record is false.',closing:'Close on the shutting gate.',next:'unavailable-next'}],
    essentials:[{id:'page',what:'The signed page.',placedWith:['the witness'],carriers:['known'],things:['page'],unlocks:'the true ending',later:'proof for the king'}],
    anchors:{gate:'the gate'},lore:['Places/Fixture.md','World/Missing.md'],
    world:{name:'The yard',description:'Wet cobbles.',size:{w:20,h:10},areas:[{id:'yard',name:'yard',rect:{x:0,y:0,w:20,h:10}}],things:[{id:'page',name:'A page',kind:'item',description:'Signed in ink.'}],people:{known:{in:'yard',at:[5,5]}}},
    afterwards:[{op:'note',text:'The cart has gone.'}],assumes:['The witness is alive.'],overtaken:'known-next',customScene:{nested:['keep',42]},
  };
  const options={revision:'test-revision',sourcePath:'scenes/fixture.ts',
    sourceFiles:{'scenes/fixture.ts':'export const fixture = /* original complete source, including helpers */ {};'},
    lorePaths:['Cast/Existing Person/public.md','Places/Fixture.md','World/Fronts.md','World/Unrelated.md'],
    destinations:{'known-next':{file:'Scenes/The Next Scene.kmscene',entry:'front-door',kind:'scene'}},
  };
  return {scene,options,executions:()=>executions};
}

test('converting a main scene preserves every beat, exit, route branch and its authored start',()=>{
  const {scene,options}=fixture(),doc=convertScene(scene,options);
  assert.equal(doc.kind,'scene');assert.equal(doc.id,scene.id);assert.equal(doc.nodes.length,4);assert.equal(doc.edges.length,12);
  assert.deepEqual(doc.nodes.map(node=>node.id),['yard','clue','won','lost']);
  assert.deepEqual(entryPorts(doc),[{id:'yard',title:'The yard',legacy:true}]);
  assert.deepEqual(parseDocument(serializeDocument(doc),'scene'),doc);
  assert.equal(new Set(doc.edges.map(edge=>edge.id)).size,doc.edges.length);
  assert.ok(doc.edges.every(edge=>doc.nodes.some(node=>node.id===edge.source)&&doc.nodes.some(node=>node.id===edge.target)));
});

test('route defaults, explicit phases, both check outcomes and implicit failure semantics are retained',()=>{
  const {scene,options}=fixture(),doc=convertScene(scene,options);
  const edges=id=>doc.edges.filter(edge=>edge.data.scope==='beat'&&edge.data.sourceRoute.id===id);
  const direct=edges('look')[0];
  assert.equal(direct.data.phase,'outcome');assert.equal(direct.target,'clue');assert.equal(direct.data.condition,scene.beats[0].transitions[0].when);
  assert.deepEqual(direct.data.sourceRoute,scene.beats[0].transitions[0]);
  const check=edges('ask');assert.equal(check.length,2);
  for(const edge of check){assert.equal(edge.data.phase,'attempt');assert.equal(edge.data.skill,'persuasion');assert.equal(edge.data.dc,12);assert.equal(edge.data.sourceRoute.check.reason,'to earn trust')}
  const success=check.find(edge=>edge.data.branch==='success'),failure=check.find(edge=>edge.data.branch==='failure');
  assert.equal(success.target,'clue');assert.equal(success.data.outcomeText,'They hand over the page.');
  assert.equal(failure.target,'yard');assert.equal(failure.data.staysInCurrentBeat,true);assert.equal(failure.data.outcomeText,'They hold it tighter.');
  assert.deepEqual(success.data.establishes,['asked','page-found']);assert.deepEqual(failure.data.establishes,['asked','rebuffed']);
  assert.ok(edges('deadline').every(edge=>edge.data.phase==='cue'));
  const explicitFailure=edges('deadline').find(edge=>edge.data.branch==='failure');
  assert.equal(explicitFailure.target,'lost');assert.notEqual(explicitFailure.data.staysInCurrentBeat,true);
  assert.equal(edges('pause')[0].target,'clue');
});

test('anytime rules appear once per beat and branch without losing their single-rule provenance',()=>{
  const {scene,options}=fixture(),doc=convertScene(scene,options);
  const anytime=doc.edges.filter(edge=>edge.data.scope==='anytime');
  assert.equal(anytime.length,6);
  for(const beat of scene.beats){
    const routes=anytime.filter(edge=>edge.source===beat.id);
    assert.equal(routes.length,3);
    for(const route of scene.anytime){
      const branches=routes.filter(edge=>edge.data.sourceRoute.id===route.id);
      assert.equal(branches.length,route.check?2:1);
      assert.ok(branches.every(edge=>JSON.stringify(edge.data.sourceRoute)===JSON.stringify(route)));
    }
  }
  assert.equal(doc.source.scene.anytime.length,2);
});

test('full scene, beat and exit metadata and inert function source survive a JSON roundtrip',()=>{
  const {scene,options,executions}=fixture(),doc=convertScene(scene,options);
  assert.equal(executions(),0);
  assert.deepEqual(doc.source.scene,inert(scene));
  assert.deepEqual(doc.source.sourceFiles,options.sourceFiles);
  assert.equal(doc.source.kind,'main-typescript-scene-import');assert.equal(doc.source.revision,options.revision);assert.equal(doc.source.path,options.sourcePath);
  assert.ok(Object.values(doc.source.functionSnapshots).includes(Function.prototype.toString.call(scene.exits[0].script)));
  assert.deepEqual(doc.nodes.find(node=>node.id==='yard').data.sourceBeat,inert(scene.beats[0]));
  const exit=doc.nodes.find(node=>node.id==='won');
  assert.deepEqual(exit.data.sourceExit,inert(scene.exits[0]));
  assert.equal(exit.data.scriptSource,Function.prototype.toString.call(scene.exits[0].script));
  assert.equal(exit.data.exitKind,'progress');
  assert.ok(exit.data.description.includes(scene.exits[0].outcome));assert.ok(exit.data.description.includes(scene.exits[0].closing));
  assert.deepEqual(JSON.parse(JSON.stringify(doc)).source,doc.source);
  for(const value of [scene.setting,scene.premise,scene.hook,scene.opening,scene.limits[0],scene.essentials[0].what])assert.ok(doc.description.includes(value),`Scene description contains ${value}`);
});

test('known destinations name exact source files and entry ports; unknown destinations remain unresolved',()=>{
  const {scene,options}=fixture(),doc=convertScene(scene,options);
  const known=doc.nodes.find(node=>node.id==='won').data,unknown=doc.nodes.find(node=>node.id==='lost').data;
  assert.equal(known.next,'known-next');assert.equal(known.file,'Scenes/The Next Scene.kmscene');assert.equal(known.entry,'front-door');assert.equal(known.destinationKind,'scene');
  assert.equal(unknown.next,'unavailable-next');assert.equal(unknown.file,undefined);assert.equal(unknown.entry,undefined);
  const invalid=convertScene(scene,{...options,destinations:{'known-next':{file:'',entry:''}}}).nodes.find(node=>node.id==='won').data;
  assert.equal(invalid.next,'known-next');assert.equal(invalid.file,undefined);assert.equal(invalid.entry,undefined);
});

test('lore links only reference supplied existing notes and missing lore is reported rather than invented',()=>{
  const {scene,options}=fixture(),doc=convertScene(scene,options);
  for(const linked of [...doc.lore,...doc.nodes.flatMap(node=>node.data.lore)])assert.ok(options.lorePaths.includes(linked),`Unknown lore link: ${linked}`);
  for(const required of ['Cast/Existing Person/public.md','Places/Fixture.md','World/Fronts.md'])assert.ok(doc.lore.includes(required));
  assert.ok(!doc.lore.includes('World/Unrelated.md'));
  assert.equal(doc.source.loreResolution.cast.known,'Cast/Existing Person/public.md');
  assert.equal(doc.source.loreResolution.cast.missing,undefined);
  assert.ok(doc.source.unresolvedLore.some(item=>item.kind==='scene'&&item.value==='World/Missing.md'));
  assert.ok(doc.source.unresolvedLore.some(item=>item.kind==='cast'&&item.characterId==='missing'));
});

test('pure conversion cannot mutate original scene metadata, destination references or user-file snapshots',()=>{
  const {scene,options}=fixture();
  options.sourceFiles['lore/Scenes/User edited.kmscene']='{"title":"Keep my changes exactly"}\n\n';
  const beforeScene=inert(scene),beforeOptions=inert(options);
  freeze(scene);freeze(options);
  const first=convertScene(scene,options),second=convertScene(scene,options);
  assert.deepEqual(inert(scene),beforeScene);assert.deepEqual(inert(options),beforeOptions);
  assert.deepEqual(first,second);
  assert.equal(options.sourceFiles['lore/Scenes/User edited.kmscene'],'{"title":"Keep my changes exactly"}\n\n');
});

// The retired prototype's scenes and lore: KINGMAKER_MAIN_REPO's checkout, or by default its last commit out of git history.
const prototype=prototypeGame(process.env.KINGMAKER_MAIN_REPO);
after(()=>prototype.done());
const mainRoot=prototype.game;
const sourceModules=['scenes/interludes.ts','scenes/drowned-rat.ts','scenes/heron-warehouse.ts','scenes/kings-morning.ts'];
test('all five real main-game Caerwyn scenes convert with exact counts, routes, lore and continuation entries',{
  skip:!sourceModules.every(file=>existsSync(path.join(mainRoot,file)))?'Main Kingmaker checkout is not available here':false,
},async()=>{
  const imported=await Promise.all(sourceModules.map(file=>import(pathToFileURL(path.join(mainRoot,file)).href)));
  const scenes=imported.flatMap(module=>Object.values(module).filter(value=>value&&typeof value==='object'&&Array.isArray(value.beats)&&Array.isArray(value.exits)));
  const expected={'caerwyn-afternoon':[2,1],'drowned-rat':[9,89],'wharf-night':[2,1],'heron-warehouse':[9,51],'kings-morning':[5,20]};
  assert.deepEqual(scenes.map(scene=>scene.id).sort(),Object.keys(expected).sort());
  const collect=(folder,prefix='')=>readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?collect(path.join(folder,entry.name),`${prefix}${entry.name}/`):entry.name.endsWith('.md')?[`${prefix}${entry.name}`]:[]);
  const lorePaths=collect(path.join(mainRoot,'lore'));
  const destinations=Object.fromEntries(scenes.map(scene=>[scene.id,{file:`Scenes/${scene.title}.kmscene`,entry:scene.start,kind:'scene'}]));
  const sourceFiles=Object.fromEntries(sourceModules.map(file=>[file,readFileSync(path.join(mainRoot,file),'utf8')]));
  for(const scene of scenes){
    const sourcePath=sourceModules.find((_file,index)=>Object.values(imported[index]).includes(scene));
    const doc=convertScene(scene,{revision:'main-working-tree-test',sourcePath,sourceFiles,lorePaths,destinations});
    assert.deepEqual([doc.nodes.length,doc.edges.length],expected[scene.id],scene.id);
    assert.deepEqual(parseDocument(serializeDocument(doc),'scene'),doc);
    assert.deepEqual(doc.source.scene,inert(scene));
    assert.equal(entryPorts(doc).find(port=>port.id===scene.start)?.legacy,true);
    assert.equal(doc.source.unresolvedLore.length,0,`${scene.id} has only existing lore references`);
    for(const exit of scene.exits){
      const converted=doc.nodes.find(node=>node.id===exit.id).data;
      if(exit.next){assert.equal(converted.next,exit.next);assert.equal(converted.file,destinations[exit.next].file);assert.equal(converted.entry,destinations[exit.next].entry)}
      else {assert.equal(converted.next,undefined);assert.equal(converted.file,undefined)}
    }
    for(const edge of doc.edges){
      const beat=scene.beats.find(beat=>beat.id===edge.source);
      const original=(edge.data.scope==='anytime'?scene.anytime:beat.transitions).find(route=>route.id===edge.data.sourceRoute.id);
      assert.ok(original);assert.deepEqual(edge.data.sourceRoute,inert(original));
      assert.equal(edge.data.phase,original.on??(original.check?'attempt':'outcome'));
      assert.equal(edge.target,original.check?(edge.data.branch==='success'?original.check.onSuccess:original.check.onFailure??beat.id):original.to??beat.id);
    }
  }
});
