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
const {openSceneFile,serializeScene,SceneOpenError,withKey,ORDER,setSceneField,setNodeField,setRouteField,setCastField,addNode,addRoute,addCast,removeNodes,removeCast,addFact,removeFact,moveRoutes,skeletonScene,slugOf,uniqueId,problemsOf,shapeOf,setArrival}=model;

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
    {message:'route signed-murder goes to a good ending (murder-unknown) but requires nothing found',at:{kind:'route',id:'signed-murder'}},
    {message:'discovery hobb is required, but no route into a good ending requires it',at:{kind:'node',id:'hobb'}},
  ]);
  const unlisted=problemsOf('the-lamplighter',skeletonScene('The Lamplighter'),contextOf(campaign,'the-lamplighter'));
  assert.deepEqual(unlisted.map(problem=>problem.message),[
    'it has no description','it has no hook','it has no setting','it has no premise','it has no truth',
    'start has no description','discovery has no description','ending has no description','ending ending has no closing',
    'discovery discovery has no revelation','discovery discovery has 0 paths, not two or more',
    'ending can\'t be reached from the start','it has no good or mixed ending that can be reached',
  ]);
});
