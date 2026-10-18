import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// The plugin's model of the scenario (src/scenario/model.ts) and of the campaign around it
// (src/campaign/files.ts), on the game's own campaign: the flow drawn from the files that own it,
// never stored, and the scenario format's rules as the campaign check runs them.
const bundle=async entry=>{
  const output=await build({entryPoints:[new URL(entry,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
};
const model=await bundle('../src/scenario/model.ts');
const files=await bundle('../src/campaign/files.ts');
const maps=await bundle('../src/map/model.ts');
const {openScenarioFile,serializeScenario,scenarioShapeOf,flowOf,layoutOf,withLayout,withStart,setStartField,setScenarioField,setCreationField,landingOn,newScenario,START_CARD,sceneCard,mapCard}=model;
const {readCampaignFiles,campaignProblems,withDraft,campaignRootOf,keyOfPath,endingsOf}=files;

const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const read=file=>readFile(new URL(file,CAMPAIGN),'utf8');
const scenarioText=await read('caerwyn.kmscenario');

/** The campaign folder as a vault's files, with some of them as an editor has them (`drafts`, by path). */
async function vault(drafts={},prefix=''){
  const folder=fileURLToPath(CAMPAIGN);
  const all=(await readdir(folder,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>path.relative(folder,path.join(entry.parentPath,entry.name)).split(path.sep).join('/')).filter(file=>!file.split('/').some(part=>part.startsWith('.'))).map(file=>prefix+file);
  return {list:dir=>[...new Set([...all,...Object.keys(drafts)])].filter(file=>file.startsWith(dir)),read:async file=>file in drafts?drafts[file]:all.includes(file)?read(file.slice(prefix.length)):undefined};
}

test('the real scenario opens with the game\'s parse and saves to the same bytes; its own fields are edited in place',()=>{
  const doc=openScenarioFile(scenarioText);
  assert.equal(serializeScenario(doc),scenarioText);
  assert.deepEqual(scenarioShapeOf(doc),[]);
  let next=setStartField(doc,'time','evening');
  assert.equal(next.start.time,'evening');
  assert.deepEqual(Object.keys(next.start),['day','time','map','at']);
  next=withStart(doc,'palace',{x:2,y:10});
  assert.deepEqual(next.start,{day:1,time:'morning',map:'palace',at:[2,10]});
  assert.equal(withStart(doc,'caerwyn',{x:42,y:9}),doc,'the same start is the same scenario');
  next=withStart(doc,undefined,undefined);
  assert.deepEqual(next.start,{day:1,time:'morning'});
  assert.deepEqual(Object.keys(setScenarioField(doc,'talk',undefined)),Object.keys(doc).filter(key=>key!=='talk'));
  next=setCreationField(doc,'notCanon',['World/Fronts.md']);
  assert.deepEqual(next.creation.notCanon,['World/Fronts.md']);
  assert.deepEqual(Object.keys(next.creation),Object.keys(doc.creation));
  const fresh=newScenario('The Lamplighter');
  assert.deepEqual(scenarioShapeOf(fresh),[]);
  assert.equal(fresh.id,'the-lamplighter');
});

test('the campaign around any of its files: its root, the scenario, every scene, map and place it lists, and the keys present in each folder',async()=>{
  assert.equal(campaignRootOf('caerwyn.kmscenario'),'');
  assert.equal(campaignRootOf('maps/caerwyn.kmmap'),'');
  assert.equal(campaignRootOf('campaigns/caerwyn/places/heron.kmplace'),'campaigns/caerwyn/');
  assert.equal(campaignRootOf('Maps/Harbour study.kmmap'),'Maps/');
  assert.equal(keyOfPath('maps/caerwyn.kmmap'),'caerwyn');
  for(const prefix of ['','campaigns/caerwyn/']){
    const campaign=await readCampaignFiles(`${prefix}maps/palace.kmmap`,await vault({},prefix));
    assert.equal(campaign.root,prefix);
    assert.equal(campaign.error,undefined);
    assert.equal(campaign.scenarioPath,`${prefix}caerwyn.kmscenario`);
    assert.deepEqual(campaign.scenes.map(scene=>scene.key),['hanged-clerk','caerwyn-afternoon','drowned-rat','wharf-night','heron-warehouse','kings-morning','talk']);
    assert.ok(campaign.scenes.every(scene=>scene.doc&&!scene.error));
    assert.deepEqual(campaign.maps.map(map=>[map.key,!!map.doc]),[['caerwyn',true],['drowned-rat',true],['heron',true],['palace',true]]);
    assert.deepEqual(campaign.places.map(place=>place.key),['granary-yard','drowned-rat','heron','dressing-room']);
    assert.deepEqual(campaign.present.maps,['caerwyn','drowned-rat','heron','palace']);
    assert.equal(campaign.lore.length,154);
    assert.equal(campaign.looks.kell.glyph,'K');
    assert.deepEqual(campaignProblems(campaign),[],'the campaign check finds nothing');
  }
  // An open editor's draft is the file the campaign is read from.
  const draft=scenarioText.replace('"title": "Caerwyn"','"title": "Caerwyn, redrafted"');
  assert.equal((await readCampaignFiles('maps/heron.kmmap',await vault({'caerwyn.kmscenario':draft}))).scenario.title,'Caerwyn, redrafted');
  // A folder with no scenario, or two, says so.
  assert.match((await readCampaignFiles('maps/x.kmmap',{list:()=>['maps/x.kmmap'],read:async()=>undefined})).error,/the campaign has no scenario \(<id>\.kmscenario\)/);
  assert.match((await readCampaignFiles('a.kmscenario',{list:()=>['a.kmscenario','b.kmscenario'],read:async()=>'{}'})).error,/2 scenarios \(a\.kmscenario, b\.kmscenario\): a campaign has one/);
});

test('the flow is drawn from the files that own it: the start, each ending\'s next, each region\'s scene and each map\'s ways out',async()=>{
  const campaign=await readCampaignFiles('caerwyn.kmscenario',await vault());
  const flow=flowOf(campaign.scenario,campaign);
  assert.deepEqual(flow.cards.map(card=>card.id),[START_CARD,...['hanged-clerk','caerwyn-afternoon','drowned-rat','wharf-night','heron-warehouse','kings-morning'].map(sceneCard),...['caerwyn','drowned-rat','heron','palace'].map(mapCard)]);
  const edge=(source,handle)=>flow.edges.find(e=>e.source===source&&e.sourceHandle===handle);
  assert.deepEqual(edge(START_CARD,'start:map'),{id:'start>start:map',source:START_CARD,sourceHandle:'start:map',target:mapCard('caerwyn'),label:'Starts on Caerwyn',owner:{kind:'start'}});
  assert.equal(edge(START_CARD,'start:lead').target,sceneCard('hanged-clerk'));
  assert.equal(edge(sceneCard('hanged-clerk'),'ending:murder-unknown').target,sceneCard('caerwyn-afternoon'));
  assert.equal(edge(sceneCard('hanged-clerk'),'ending:failed'),undefined,'an ending with no next ends the story');
  assert.deepEqual(edge(mapCard('caerwyn'),'region:0').owner,{kind:'region',map:'caerwyn',index:0,region:'granary-yard'});
  assert.equal(edge(mapCard('caerwyn'),'region:2').dashed,true,'the wharf\'s end opens the Heron, laid on its own map');
  // The town's four tiles along the wharf to the Heron are one way out.
  const heron=flow.cards.find(card=>card.id===mapCard('caerwyn')).ports.find(port=>port.target===mapCard('heron'));
  assert.deepEqual(heron.owner,{kind:'exits',map:'caerwyn',indices:[2,3,4,5],label:'Along the wharf to the Heron',to:'heron'});
  assert.equal(heron.detail,'4 tiles');
  assert.equal(flow.edges.length,31,'the start\'s 2, the endings\' 16, the regions\' 6 and the ways between maps\' 7');
  // Every edge is its owner's: the story's flow is in the scenes' endings and the maps, nothing stored.
  const nexts=campaign.scenes.flatMap(scene=>endingsOf(scene).filter(e=>e.next).map(e=>[scene.key,e.id,e.next]));
  assert.deepEqual(flow.edges.filter(e=>e.owner.kind==='ending').map(e=>[e.owner.scene,e.owner.ending,e.target.slice(6)]),nexts);
  assert.ok(!('flow' in campaign.scenario)&&!('edges' in campaign.scenario));
});

test('the layout: where the scenario keeps each card, and where it puts what it doesn\'t keep',async()=>{
  const campaign=await readCampaignFiles('caerwyn.kmscenario',await vault());
  const flow=flowOf(campaign.scenario,campaign);
  const unplaced=layoutOf(flow,undefined);
  assert.deepEqual(unplaced.get(START_CARD),{x:-380,y:200});
  assert.deepEqual(unplaced.get(sceneCard('drowned-rat')),{x:760,y:0});
  assert.deepEqual(unplaced.get(mapCard('heron')),{x:760,y:460});
  const doc=withLayout(campaign.scenario,{'maps/heron':{x:10.4,y:-20.6},start:{x:0,y:0}});
  assert.deepEqual(doc.layout,{'maps/heron':{x:10,y:-21},start:{x:0,y:0}});
  assert.equal(Object.keys(doc).at(-1),'layout','the layout goes last, where the format puts it');
  assert.deepEqual(layoutOf(flow,doc.layout).get(mapCard('heron')),{x:10,y:-21});
  assert.equal(withLayout(doc,{'maps/heron':{x:10,y:-21}}),doc);
  assert.deepEqual(scenarioShapeOf(doc),[]);
});

test('the rules see an editor\'s draft: a broken map or scenario is a problem in its own file, and a draft that mends it clears it',async()=>{
  const campaign=await readCampaignFiles('maps/caerwyn.kmmap',await vault());
  const town=campaign.maps.find(map=>map.key==='caerwyn').doc;
  const broken={...town,exits:town.exits.map((exit,i)=>i===0?{...exit,to:{map:'castle',at:exit.to.at}}:exit)};
  const problems=campaignProblems(withDraft(campaign,'map','caerwyn',broken,maps.serializeMap(broken)));
  assert.deepEqual(problems.map(p=>[p.path,p.message,p.at]),[
    ['maps/caerwyn.kmmap','"Through the palace gate" goes to castle, which isn\'t one of the campaign\'s maps',{kind:'map',map:'caerwyn',exit:0}],
  ]);
  const moved=withStart(campaign.scenario,'caerwyn',{x:0,y:44});
  assert.deepEqual(campaignProblems(withDraft(campaign,'scenario','caerwyn',moved,serializeScenario(moved))).map(p=>[p.path,p.message]),[
    ['caerwyn.kmscenario','it starts at (0, 44) on caerwyn, where nobody can stand'],
  ]);
  // A listed file that isn't of its format's shape is its own problem, and the rules wait for it.
  const mangled=await readCampaignFiles('caerwyn.kmscenario',await vault({'places/heron.kmplace':'{"format":"kingmaker"}'}));
  assert.match(campaignProblems(mangled)[0].message,/places\/heron\.kmplace: it isn't a place of the kingmaker format/);
  assert.equal(campaignProblems(mangled).length,1);
});

test('a way into a map lands just inside a way back, or nearest the middle, on ground a person can stand on',async()=>{
  const campaign=await readCampaignFiles('caerwyn.kmscenario',await vault());
  const rat=campaign.maps.find(map=>map.key==='drowned-rat').doc;
  const landing=landingOn(rat,'caerwyn');
  assert.ok(!rat.exits.some(exit=>exit.at.x===landing.x&&exit.at.y===landing.y),'not on a way out');
  const back=rat.exits.find(exit=>exit.to.map==='caerwyn').at;
  assert.ok(Math.max(Math.abs(back.x-landing.x),Math.abs(back.y-landing.y))<=1,'beside the way back');
  assert.deepEqual(landingOn(campaign.maps.find(map=>map.key==='heron').doc,'nowhere'),{x:11,y:9});
});
