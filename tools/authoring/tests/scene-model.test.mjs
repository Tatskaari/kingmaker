import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// The plugin's model of a scene file (src/scene/model.ts) and of the campaign around it (campaign.ts),
// on the game's own campaign: the files are the game's, read with its parse and held to its rules.
const bundle=async entry=>{
  const output=await build({entryPoints:[new URL(entry,import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
  return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
};
const model=await bundle('../src/scene/model.ts');
const {campaignRootOf,contextOf,readCampaign,sceneKeyOf}=await bundle('../src/scene/campaign.ts');
const {openSceneFile,serializeScene,SceneOpenError,withKey,ORDER,setSceneField,setNodeField,setRouteField,setCastField,addNode,addRoute,addCast,removeNodes,removeCast,addFact,removeFact,renameFact,settlesOf,testsOf,idProblem,renameNode,renameRoute,renameCast,makeEvent,makeDiscovery,moveRoutes,skeletonScene,slugOf,uniqueId,problemsOf,shapeOf,setArrival,freePosition,retitleNode,changeKind,kindLosses}=model;

const CAMPAIGN=new URL('../../../campaigns/caerwyn/',import.meta.url);
const TESTDATA=new URL('../../../shared/scene/testdata/',import.meta.url);
const read=path=>readFile(new URL(path,CAMPAIGN),'utf8');
const sceneFiles=(await readdir(new URL('scenes/',CAMPAIGN))).filter(name=>name.endsWith('.kmscene')).sort();
const clerkText=await read('scenes/hanged-clerk.kmscene');
const clerk=()=>openSceneFile(clerkText).doc;

/** The campaign folder as a vault's files, for readCampaign. */
async function campaignFiles(){
  const folder=fileURLToPath(CAMPAIGN);
  const all=(await readdir(folder,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>path.relative(folder,path.join(entry.parentPath,entry.name)).split(path.sep).join('/'));
  return {list:folder=>all.filter(path=>path.startsWith(folder)),read:async path=>all.includes(path)?read(path):undefined};
}

test('every real scene opens with the game\'s parse and saves to the same bytes',async()=>{
  assert.deepEqual(sceneFiles,['caerwyn-afternoon.kmscene','drowned-rat.kmscene','hanged-clerk.kmscene','heron-warehouse.kmscene','kings-morning.kmscene','talk.kmscene','wharf-night.kmscene']);
  const texts=[...await Promise.all(sceneFiles.map(name=>read(`scenes/${name}`))),await readFile(new URL('hanged-clerk.kmscene',TESTDATA),'utf8')];
  for(const text of texts){
    const file=openSceneFile(text);
    assert.equal(file.kind,'scene');
    assert.equal(serializeScene(file.doc),text,`${file.doc.id} round-trips byte for byte`);
    assert.deepEqual(shapeOf(file.doc),[]);
  }
});

test('unknown keys are kept where they are, through edits; a key the format knows goes where the format puts it',()=>{
  const doc=clerk();
  doc.authorNote='kept at the top';
  doc.nodes[1].colour='teal';doc.nodes[1].data.draft=true;
  doc.edges[0].weight=3;doc.edges[0].data.note='kept in data';
  doc.cast[0].pronouns='she';doc.nodes[1].data.paths[0].source='kell';
  const text=serializeScene(doc);
  const reopened=openSceneFile(text).doc;
  assert.equal(serializeScene(reopened),text);

  const edited=setRouteField(setNodeField(setCastField(reopened,'kell','fears','Nothing.'),'murder','title','It was murder'),'find-murder','condition','Once the body is seen.');
  const saved=JSON.parse(serializeScene(edited));
  assert.equal(saved.authorNote,'kept at the top');
  assert.deepEqual([saved.nodes[1].colour,saved.nodes[1].data.draft,saved.edges[0].weight,saved.edges[0].data.note,saved.cast[0].pronouns,saved.nodes[1].data.paths[0].source],['teal',true,3,'kept in data','she','kell']);
  assert.deepEqual(Object.keys(saved.nodes[1].data),Object.keys(reopened.nodes[1].data),'an edit keeps every key in its place');

  // A key taken out and set again goes back where the format puts it: the file is as it was.
  const original=clerk();
  assert.equal(serializeScene(setSceneField(setSceneField(original,'clock',undefined),'clock',original.clock)),clerkText);
  const noRequires=setRouteField(original,'signed-murder','requires',undefined);
  assert.deepEqual(Object.keys(noRequires.edges.find(route=>route.id==='signed-murder').data),['condition','phase','skill','dc']);
  assert.equal(serializeScene(setRouteField(noRequires,'signed-murder','requires',['murder','hobb'])),clerkText);
  assert.deepEqual(Object.keys(withKey({a:1,z:2,c:3},'b',9,['a','b','c'])),['a','z','b','c'],'an unknown key stays where it was, after the key it followed');
});

test('what isn\'t a scene of the format is refused, naming what\'s wrong; a version 1 scene opens read-only',async()=>{
  const v1=await readFile(new URL('fixtures/v1/Scenes/The%20Hanged%20Clerk.kmscene',import.meta.url),'utf8');
  assert.deepEqual(openSceneFile(v1),{kind:'v1',title:'The Hanged Clerk',nodes:10,routes:51});
  const refused=(text,pattern)=>assert.throws(()=>openSceneFile(text),error=>error instanceof SceneOpenError&&pattern.test(error.message));
  refused('{ nope',/isn't JSON/);
  refused(JSON.stringify({format:'kingmaker',version:1,kind:'scenario',title:'Caerwyn',nodes:[],edges:[]}),/isn't a scene of the kingmaker format, version 2/);
  const changed=change=>{const doc=JSON.parse(clerkText);change(doc);return JSON.stringify(doc)};
  refused(changed(doc=>{doc.version=3}),/version 2/);
  refused(changed(doc=>{doc.edges[0].target='the-moon'}),/target "the-moon" isn't a node of the scene/);
  refused(changed(doc=>{doc.nodes.push(structuredClone(doc.nodes[1]))}),/the node id murder is there twice/);
  refused(changed(doc=>{doc.nodes=doc.nodes.filter(node=>node.data.kind!=='start')}),/0 start nodes/);
  refused(changed(doc=>{doc.edges[4].data.requires=['nowhere']}),/requires nowhere, which isn't a node/);
  refused(changed(doc=>{doc.nodes[1].data.establishes=['unheard-of']}),/establishes unheard-of, which isn't one of its facts/);
  refused(changed(doc=>{delete doc.cast[0].knows}),/knows isn't a list of text/);
});

test('ids are slugs made once from titles: free in the scene, and stable when the title changes',()=>{
  assert.equal(slugOf('The Hanged Clerk'),'the-hanged-clerk');
  assert.equal(slugOf("Kell's notebook — É!"),'kells-notebook-e');
  assert.equal(slugOf('***'),'');
  assert.equal(uniqueId('murder',['murder','murder-2']),'murder-3');
  const added=addNode(clerk(),'discovery','The ledger page',{x:10.4,y:20.6},{from:'start'});
  assert.equal(added.id,'the-ledger-page');
  assert.equal(added.route,'find-the-ledger-page');
  const node=added.doc.nodes.at(-1);
  assert.deepEqual(node,{id:'the-ledger-page',type:'story',position:{x:10,y:21},data:{kind:'beat',title:'The ledger page',description:'',revelation:'',paths:[],lore:[]}});
  assert.deepEqual(added.doc.edges.at(-1),{id:'find-the-ledger-page',source:'start',target:'the-ledger-page',type:'smoothstep',label:'Find The ledger page',data:{condition:'',phase:'outcome',skill:'',dc:12}});
  const again=addNode(added.doc,'event','The ledger page',{x:0,y:0});
  assert.equal(again.id,'the-ledger-page-2');
  assert.equal(again.route,undefined,'no route without a node to come from');
  const retitled=setNodeField(added.doc,'the-ledger-page','title','Prout\'s page');
  assert.equal(retitled.nodes.at(-1).id,'the-ledger-page');
  assert.equal(addRoute(clerk(),'start','cart-arrives').doc.edges.at(-1).data.phase,'cue','a route into an event is a cue');
  assert.equal(addNode(clerk(),'ending','Run away',{x:0,y:0},{from:'failed'}).route,undefined,'no route leaves an ending');
  assert.equal(addCast(clerk(),'Sergeant Agnes Kell').id,'sergeant-agnes-kell');
  assert.equal(addCast(clerk(),'Kell','kell').id,'kell-2');
});

test('a new card goes beside the node it comes from, below the cards already there, never on one',()=>{
  // The skeleton's discovery is where a second node from the start would go: the new one lands below it.
  const skeleton=skeletonScene('The Short Weight');
  assert.deepEqual(freePosition(skeleton,{x:400,y:0}),{x:400,y:220});
  assert.deepEqual(freePosition(skeleton,{x:400,y:0},{discovery:{width:260,height:300}}),{x:400,y:340},'a measured card is its own height');
  // And below the next one too, until it's clear of them all; clear ground is where it was wanted.
  const two=addNode(skeleton,'discovery','Tam swaps the sacks',{x:400,y:220}).doc;
  assert.deepEqual(freePosition(two,{x:400,y:0}),{x:400,y:440});
  assert.deepEqual(freePosition(two,{x:1200,y:0}),{x:1200,y:0});
  assert.deepEqual(freePosition(two,{x:600.6,y:-30}),{x:601,y:440},'overlapping a card sideways counts too');
});

test('a node retitled takes the routes into it that still have the label they were given from its title; one the author wrote stays',()=>{
  const skeleton=skeletonScene('The Short Weight');
  assert.equal(skeleton.edges[0].label,'Find Discovery');
  const retitled=retitleNode(skeleton,'discovery','The weights are true');
  assert.equal(retitled.nodes[1].data.title,'The weights are true');
  assert.equal(retitled.edges[0].label,'Find The weights are true');
  assert.equal(retitled.edges[0].id,'find-discovery','its id stays: game state keys on it');
  // Typed a letter at a time, it follows each.
  assert.equal(['T','Th','The'].reduce((doc,title)=>retitleNode(doc,'discovery',title),skeleton).edges[0].label,'Find The');
  // Into an event or an ending, the label is the title.
  const event=addNode(skeleton,'event','The cart comes',{x:0,y:400},{from:'start'});
  assert.equal(retitleNode(event.doc,event.id,'The cart comes early').edges.find(route=>route.id===event.route).label,'The cart comes early');
  // A label the author wrote stays as it is; a title unchanged is the same scene.
  const written=setRouteField(skeleton,'find-discovery','condition','x');
  const labelled={...written,edges:written.edges.map(route=>({...route,label:'Check the weights'}))};
  assert.equal(retitleNode(labelled,'discovery','The weights are true').edges[0].label,'Check the weights');
  assert.equal(retitleNode(skeleton,'discovery','Discovery'),skeleton);
  const murder=clerk().nodes.find(other=>other.id==='murder');
  assert.equal(retitleNode(clerk(),'murder','Murder, plainly').edges.find(route=>route.target==='murder').label,clerk().edges.find(route=>route.target==='murder').label,'the clerk\'s labels are written, and stay');
  assert.ok(murder);
});

test('taking something out takes what named it with it, so the game can still load the file',()=>{
  const doc=setArrival(setRouteField(clerk(),'signed-murder','onFailure','hobb'),'kell','cart-arrives',true);
  const without=removeNodes(doc,['hobb','cart-arrives','start']);
  assert.ok(without.nodes.some(node=>node.id==='start'),'the start stays');
  assert.deepEqual(shapeOf(without),[]);
  assert.ok(!without.edges.some(route=>[route.source,route.target].includes('hobb')));
  assert.equal(without.cast.find(member=>member.id==='kell').enters,undefined);
  const gone=removeFact(clerk(),'hobb-at-granary');
  assert.equal(gone.facts['hobb-at-granary'],undefined);
  assert.ok(!gone.nodes.some(node=>node.data.establishes?.includes('hobb-at-granary')));
  assert.deepEqual(shapeOf(gone),[]);
  const {doc:withFact,id}=addFact(clerk(),'','Kell has seen the page.');
  assert.equal(id,'kell-has-seen-the-page');
  assert.equal(withFact.facts[id],'Kell has seen the page.');
  const moved=moveRoutes(clerk(),['signed-murder','signed-suicide'],'source','start');
  assert.deepEqual(moved.edges.filter(route=>route.source==='start').map(route=>route.id),['find-murder','find-motive','find-hobb','cart-comes','signed-murder','signed-suicide','case-lost']);
  assert.deepEqual(Object.keys(moved.edges[4]),['id','source','target','type','label','data'],'a moved route keeps its keys where they were');
  const noMoll=removeCast(clerk(),'moll');
  assert.ok(!noMoll.cast.some(member=>member.id==='moll'));
  assert.ok(!noMoll.nodes.some(node=>node.data.cast&&'moll' in node.data.cast));
});

test('a fact renamed or taken out follows every place it\'s named: the facts, establishes, and effects\' conditions',()=>{
  const nodeOf=(doc,id)=>doc.nodes.find(node=>node.id===id);
  let doc=clerk();
  doc=setNodeField(doc,'failed','effects',[...nodeOf(doc,'failed').data.effects,
    {op:'journal',text:'Hobb was there.',if:{established:'hobb-at-granary'}},
    {op:'journal',text:'The motive too.',if:{established:['hobb-at-granary','motive-known']},unless:{established:'killed-not-suicide'}}]);
  doc=setSceneField(doc,'onEnd',[{op:'follow',who:'kell',unless:{established:['hobb-at-granary']}}]);
  doc=setRouteField(doc,'case-lost','establishes',['hobb-at-granary']);
  assert.deepEqual(settlesOf(doc,'hobb-at-granary'),[{kind:'node',id:'hobb'},{kind:'route',id:'case-lost'}]);
  assert.deepEqual(testsOf(doc,'hobb-at-granary'),[
    {at:{kind:'scene',field:'onEnd'},index:0,key:'unless',op:'follow'},
    {at:{kind:'node',id:'failed'},index:4,key:'if',op:'journal'},
    {at:{kind:'node',id:'failed'},index:5,key:'if',op:'journal'},
  ]);

  const renamed=renameFact(doc,'hobb-at-granary','hobb-seen');
  assert.deepEqual(Object.keys(renamed.facts),['killed-not-suicide','motive-known','hobb-seen'],'the key keeps its place');
  assert.equal(renamed.facts['hobb-seen'],doc.facts['hobb-at-granary']);
  assert.deepEqual(nodeOf(renamed,'hobb').data.establishes,['hobb-seen']);
  assert.deepEqual(renamed.edges.find(route=>route.id==='case-lost').data.establishes,['hobb-seen']);
  const effects=nodeOf(renamed,'failed').data.effects;
  assert.deepEqual(effects[4].if,{established:'hobb-seen'});
  assert.deepEqual(effects[5].if,{established:['hobb-seen','motive-known']});
  assert.deepEqual(renamed.onEnd[0].unless,{established:['hobb-seen']},'a list stays a list');
  assert.equal(nodeOf(renamed,'murder'),nodeOf(doc,'murder'),'what doesn\'t name it is the same object');
  assert.deepEqual(shapeOf(renamed),[]);
  assert.equal(renameFact(doc,'no-such-fact','x'),doc);

  const removed=removeFact(renamed,'hobb-seen');
  assert.ok(!('hobb-seen' in removed.facts));
  assert.equal(nodeOf(removed,'hobb').data.establishes,undefined);
  const left=nodeOf(removed,'failed').data.effects;
  assert.deepEqual(left[4],{op:'journal',text:'Hobb was there.'},'a condition with no fact left goes');
  assert.deepEqual(left[5],{op:'journal',text:'The motive too.',if:{established:'motive-known'},unless:{established:'killed-not-suicide'}},'one fact left is written as its id');
  assert.deepEqual(removed.onEnd,[{op:'follow',who:'kell'}]);
  assert.deepEqual(shapeOf(removed),[]);
  assert.deepEqual(testsOf(removed,'hobb-seen'),[]);
});

test('a node, a route or a person renamed: every reference in the file follows, and only by asking',async()=>{
  const nodeOf=(doc,id)=>doc.nodes.find(node=>node.id===id);
  assert.equal(idProblem('Dead cart',[]),'An id is a slug: lower-case letters, digits and dashes, starting with a letter or digit.');
  assert.equal(idProblem('murder',['murder','hobb']),'murder is taken.');
  assert.equal(idProblem('murder',['murder','hobb'],'murder'),undefined,'its own id is free to it');

  const doc=setRouteField(clerk(),'signed-suicide','onFailure','hobb');
  const node=renameNode(renameNode(doc,'cart-arrives','dead-cart'),'hobb','hobb-spotted');
  assert.deepEqual(node.nodes.map(n=>n.id),['start','murder','motive','hobb-spotted','dead-cart','murder-unknown','suspicious','failed']);
  assert.deepEqual(node.edges.map(route=>[route.id,route.source,route.target]),[['find-murder','start','murder'],['find-motive','start','motive'],['find-hobb','start','hobb-spotted'],['cart-comes','start','dead-cart'],['signed-murder','dead-cart','murder-unknown'],['signed-suicide','dead-cart','suspicious'],['case-lost','start','failed']]);
  assert.deepEqual(node.edges.find(route=>route.id==='signed-murder').data.requires,['murder','hobb-spotted']);
  assert.equal(node.edges.find(route=>route.id==='signed-suicide').data.onFailure,'hobb-spotted');
  assert.equal(node.cast.find(member=>member.id==='tull').enters,'dead-cart');
  assert.deepEqual(shapeOf(node),[]);

  const route=renameRoute(clerk(),'case-lost','walked-away');
  assert.deepEqual(Object.keys(route.edges[6]),['id','source','target','type','label','data']);
  assert.equal(route.edges[6].id,'walked-away');

  let withEffects=setNodeField(clerk(),'failed','effects',[...nodeOf(clerk(),'failed').data.effects,{op:'promise',by:'cob',to:'$player',text:'A boot back.'},{op:'remove',what:'cob',text:'off up the lane'}]);
  withEffects=setSceneField(withEffects,'onEnd',[{op:'follow',who:'cob'},{op:'startFight',enemies:[{asset:'bandit',count:2,leader:'cob'}],allies:['kell','cob'],at:'yard'}]);
  const person=renameCast(withEffects,'cob','cob-the-boy');
  assert.equal(person.cast[1].id,'cob-the-boy');
  assert.deepEqual(Object.keys(person.cast[1]),Object.keys(clerk().cast[1]));
  assert.deepEqual(Object.keys(nodeOf(person,'start').data.cast),['cob-the-boy','moll','kell'],'their note keeps its place');
  assert.deepEqual(Object.keys(nodeOf(person,'cart-arrives').data.cast),['tull','kell','cob-the-boy','moll']);
  assert.deepEqual(nodeOf(person,'motive').data.paths.map(path=>path.via),['cob-the-boy','kell','cob-the-boy','the tally loft','tull']);
  assert.deepEqual(nodeOf(person,'failed').data.effects.slice(-2),[{op:'promise',by:'cob-the-boy',to:'$player',text:'A boot back.'},{op:'remove',what:'cob-the-boy',text:'off up the lane'}]);
  assert.deepEqual(person.onEnd,[{op:'follow',who:'cob-the-boy'},{op:'startFight',enemies:[{asset:'bandit',count:2,leader:'cob-the-boy'}],allies:['kell','cob-the-boy'],at:'yard'}]);
  // The place's people name him by his old id: the campaign's file, which the problems name.
  const campaign=await readCampaign('scenes/hanged-clerk.kmscene',await campaignFiles());
  assert.deepEqual(problemsOf('hanged-clerk',renameCast(clerk(),'cob','cob-the-boy'),contextOf(campaign,'hanged-clerk')).map(problem=>problem.message),['granary-yard\'s people: cob isn\'t in the cast']);
});

test('a beat\'s kind changes with its revelation: an event has no paths, a discovery is never the stage',()=>{
  const nodeOf=(doc,id)=>doc.nodes.find(node=>node.id===id);
  const event=makeEvent(setNodeField(clerk(),'hobb','pressure','Kept.'),'hobb');
  assert.deepEqual(Object.keys(nodeOf(event,'hobb').data),['kind','title','description','pressure','establishes','carry','lore']);
  assert.deepEqual(shapeOf(event),[]);
  assert.equal(makeEvent(event,'hobb'),event,'an event already');
  const discovery=makeDiscovery(clerk(),'cart-arrives');
  const data=nodeOf(discovery,'cart-arrives').data;
  assert.equal(data.revelation,'');
  assert.deepEqual(data.paths,[]);
  assert.equal(data.cast,undefined);
  assert.equal(data.pressure,undefined);
  assert.equal(discovery.cast.find(member=>member.id==='tull').enters,undefined,'who arrived there is here from the start');
  assert.deepEqual(shapeOf(discovery),[]);
});

test('a node changes kind, a beat to an ending and back, losing what the new kind has no use for and what named it as the old one',()=>{
  const nodeOf=(doc,id)=>doc.nodes.find(node=>node.id===id);
  // The dead-cart made an ending: its pressure, roles and arrival go, and its routes out (none leaves an ending).
  assert.deepEqual(kindLosses(clerk(),'cart-arrives','ending'),['its pressure','its 4 conversation roles','its 1 arrival (they\'re here from the start instead)','its 2 routes out (no route leaves an ending)']);
  const ending=changeKind(clerk(),'cart-arrives','ending');
  assert.deepEqual(nodeOf(ending,'cart-arrives').data,{kind:'exit',title:'The dead-cart arrives',description:nodeOf(clerk(),'cart-arrives').data.description,closing:'',result:'good',exitKind:'progress',lore:[]});
  assert.deepEqual(ending.edges.map(route=>route.id),['find-murder','find-motive','find-hobb','cart-comes','case-lost']);
  assert.equal(ending.cast.find(member=>member.id==='tull').enters,undefined);
  assert.deepEqual(shapeOf(ending),[]);
  // A discovery made an ending: what required it requires it no more (only a beat is required).
  assert.deepEqual(kindLosses(clerk(),'hobb','ending'),['its revelation','its 4 paths','its required mark','the 1 fact it settles','what the story carries of it','what 2 routes require of it']);
  const hobb=changeKind(clerk(),'hobb','ending');
  assert.deepEqual(hobb.edges.find(route=>route.id==='signed-murder').data.requires,['murder']);
  assert.equal(hobb.edges.find(route=>route.id==='signed-suicide').data.requires,undefined);
  assert.deepEqual(shapeOf(hobb),[]);
  // An ending made a beat: its closing, effects and next scene go; a discovery's revelation and paths are to write.
  assert.deepEqual(kindLosses(clerk(),'murder-unknown','event'),['its closing','its 6 effects','its next scene']);
  const discovery=changeKind(clerk(),'failed','discovery');
  assert.deepEqual(nodeOf(discovery,'failed').data,{kind:'beat',title:'Failed',description:nodeOf(clerk(),'failed').data.description,revelation:'',paths:[],lore:[]});
  assert.deepEqual(Object.keys(nodeOf(changeKind(clerk(),'failed','event'),'failed').data),['kind','title','description','lore']);
  assert.deepEqual(shapeOf(discovery),[]);
  // And back: a fresh ending loses nothing it was given; beats switch as before; the start stays the start.
  assert.deepEqual(kindLosses(ending,'cart-arrives','event'),[]);
  assert.deepEqual(nodeOf(changeKind(ending,'cart-arrives','event'),'cart-arrives').data,{kind:'beat',title:'The dead-cart arrives',description:nodeOf(clerk(),'cart-arrives').data.description,lore:[]});
  assert.deepEqual(kindLosses(clerk(),'murder','event'),['its revelation','its 5 paths']);
  const doc=clerk();
  assert.equal(changeKind(doc,'start','ending'),doc);
  assert.equal(changeKind(doc,'murder','discovery'),doc);
  // Unknown keys stay where they were.
  const marked=setNodeField(doc,'failed','tone','grim');
  assert.deepEqual(Object.keys(nodeOf(changeKind(marked,'failed','discovery'),'failed').data),['kind','title','description','revelation','paths','lore','tone']);
});

test('a new scene is the format\'s skeleton: a start, a discovery, an ending and a route, its ids slugs of their titles',()=>{
  const doc=skeletonScene('The Lamplighter');
  assert.equal(doc.id,'the-lamplighter');
  assert.deepEqual(doc.nodes.map(node=>[node.id,node.data.kind]),[['start','start'],['discovery','beat'],['ending','exit']]);
  assert.deepEqual(doc.edges.map(route=>[route.id,route.source,route.target]),[['find-discovery','start','discovery']]);
  assert.deepEqual(shapeOf(doc),[]);
  assert.equal(openSceneFile(serializeScene(doc)).kind,'scene');
});

test('the campaign around a scene: its root, its scenes, places and quests, its lore by the game\'s paths',async()=>{
  assert.equal(campaignRootOf('scenes/hanged-clerk.kmscene'),'');
  assert.equal(campaignRootOf('campaigns/caerwyn/scenes/hanged-clerk.kmscene'),'campaigns/caerwyn/');
  assert.equal(campaignRootOf('Drafts/new.kmscene'),'Drafts/');
  assert.equal(sceneKeyOf('scenes/hanged-clerk.kmscene'),'hanged-clerk');
  const campaign=await readCampaign('scenes/hanged-clerk.kmscene',await campaignFiles());
  assert.equal(campaign.error,undefined);
  assert.deepEqual(campaign.scenes.map(scene=>scene.id),['hanged-clerk','caerwyn-afternoon','drowned-rat','wharf-night','heron-warehouse','kings-morning','talk']);
  assert.ok(campaign.scenes.every(scene=>scene.doc&&!scene.error));
  assert.equal(campaign.talk,'talk');
  assert.deepEqual(campaign.places.map(place=>place.key),['granary-yard','drowned-rat','heron','dressing-room']);
  assert.deepEqual(Object.keys(campaign.quests),['hanged-clerk','purveyors-man','heron-ledger']);
  assert.equal(campaign.loreFiles.size,154);
  assert.ok(campaign.loreFiles.has('Cast/Cob/private.md'),'the rules see every file');
  const cob=campaign.lore.find(note=>note.path==='Cast/Cob/public.md');
  assert.deepEqual(cob,{path:'Cast/Cob/public.md',name:'Cob',kind:'character'});
  assert.ok(!campaign.lore.some(note=>/\/(private|gm|index)\.md$|\/knowledge\//.test(note.path)&&note.path.startsWith('Cast/')),'a person\'s public card is offered, not their private notes');
  assert.ok(campaign.lore.some(note=>note.path==='World/Fronts.md'&&note.kind==='world'));
  assert.ok(campaign.lore.some(note=>note.path==='Places/Granary Yard.md'&&note.kind==='place'));
});

test('the problems are the campaign check\'s: none on the real scenes, and one where it is when a scene breaks a rule',async()=>{
  const campaign=await readCampaign('scenes/hanged-clerk.kmscene',await campaignFiles());
  for(const scene of campaign.scenes)assert.deepEqual(problemsOf(scene.id,scene.doc,contextOf(campaign,scene.id)),[],scene.id);
  const broken=setRouteField(setCastField(clerk(),'cob','limits',undefined),'signed-murder','requires',undefined);
  assert.deepEqual(problemsOf('hanged-clerk',broken,contextOf(campaign,'hanged-clerk')),[
    {message:'route signed-murder goes to a good ending (murder-unknown) but requires nothing found',at:{kind:'route',id:'signed-murder',field:'requires'}},
    {message:'discovery hobb is required, but no route into a good ending requires it',at:{kind:'node',id:'hobb',field:'required'}},
  ]);
  const unlisted=problemsOf('the-lamplighter',skeletonScene('The Lamplighter'),contextOf(campaign,'the-lamplighter'));
  assert.deepEqual(unlisted.map(problem=>problem.message),[
    'it has no description','it has no hook','it has no setting','it has no premise','it has no truth',
    'start has no description','discovery has no description','ending has no description','ending ending has no closing',
    'discovery discovery has no revelation','discovery discovery has 0 paths, not two or more',
    'ending can\'t be reached from the start','it has no good or mixed ending that can be reached',
  ]);
});
