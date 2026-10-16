import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';

// Exercise only the pure projection. UI dependencies are not mounted, and these
// isolated fixtures never create or modify files in a user's vault.
const require = createRequire(import.meta.url);
const transpile = name => transformSync(readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8'),{
  loader:name.endsWith('tsx')?'tsx':'ts',format:'cjs',jsx:'automatic',
}).code;
const load = (code,resolver) => {
  const module={exports:{}};
  runInNewContext(code,{module,exports:module.exports,require:resolver,crypto:webcrypto});
  return module.exports;
};
const model=load(transpile('model.ts'),require);
const {deriveScenarioGraph}=load(transpile('ScenarioEditor.tsx'),id=>id==='./model'?model
  :id==='@xyflow/react'||id==='lucide-react'||id==='./ConfirmDialog'||id.endsWith('.css')?{}
  :require(id));
const plain=value=>JSON.parse(JSON.stringify(value));
const node=(id,kind,extra={})=>({id,type:'story',position:{x:0,y:0},data:{kind,title:id,description:'',lore:[],...extra}});
const content=(path,id,kind='scene',nodes=[])=>({path,document:{...model.emptyDocument(kind,id),id,nodes}});
const scenario=config=>({...model.emptyDocument('scenario','Test campaign'),scenario:config});
const diagram=(doc,files)=>plain(deriveScenarioGraph(doc,files));
const sourceNodes=graph=>graph.nodes.filter(node=>node.data.path);

test('every scenario has exactly one protected pseudo Start, never persisted as authored content',()=>{
  const doc=scenario({});
  doc.nodes=[node('old-start','start'),node('another-start','start')];
  const before=plain(doc),graph=diagram(doc,[]);
  assert.equal(graph.nodes.length,1);
  assert.equal(graph.nodes[0].id,'scenario-start');
  assert.equal(graph.nodes[0].deletable,false);
  assert.equal(graph.nodes[0].data.kind,'start');
  assert.equal(graph.nodes[0].data.description,'After character creation');
  assert.deepEqual(graph.nodes[0].data.entries,[]);
  assert.equal(graph.nodes[0].data.exits.length,1);
  assert.equal(graph.nodes[0].data.exits[0].id,'start');
  assert.deepEqual(graph.edges,[]);
  assert.deepEqual(plain(doc),before);
});

test('entry, explicitly included files and legacy card references form roots and follow source exits',()=>{
  const arrival=content('Scenes/Arrival.kmscene','arrival','scene',[
    node('front','start'),node('to-square','exit',{file:'Maps/Square.kmmap',entry:'north'}),
  ]);
  const square=content('Maps/Square.kmmap','square','map',[
    node('north','start'),node('to-palace','exit',{file:'Scenes/Palace.kmscene',entry:'hall'}),
  ]);
  const palace=content('Scenes/Palace.kmscene','palace','scene',[node('hall','start')]);
  const included=content('Scenes/Optional.kmscene','optional','scene',[node('entry','start')]);
  const legacy=content('Scenes/Legacy.kmscene','legacy','scene',[node('yard','beat',{start:true})]);
  const doc=scenario({entry:{file:arrival.path,entry:'front'},files:[included.path,arrival.path]});
  doc.nodes=[node('legacy-reference','scene',{file:legacy.path})];
  const graph=diagram(doc,[arrival,square,palace,included,legacy]);
  assert.deepEqual(sourceNodes(graph).map(node=>node.data.path).sort(),[arrival.path,square.path,palace.path,included.path,legacy.path].sort());
  assert.equal(graph.edges.length,3);
  const start=graph.edges.find(edge=>edge.data.isStart);
  assert.equal(start.target,`file:${arrival.path}`);
  assert.equal(start.targetHandle,'entry:front');
  assert.equal(graph.edges.find(edge=>edge.data.sourcePath===square.path).target,`file:${palace.path}`);
  assert.equal(sourceNodes(graph).find(node=>node.data.path===legacy.path).data.entries[0].legacy,true);
});

test('different named exits to the same file remain separate ports and destination edges',()=>{
  const target=content('Maps/Square.kmmap','square','map',[node('north','start'),node('south','start')]);
  const source=content('Scenes/Arrival.kmscene','arrival','scene',[
    node('entry','start'),
    node('peaceful','exit',{file:target.path,entry:'north'}),
    node('escape','exit',{file:target.path,entry:'south'}),
    node('follow','exit',{file:target.path,entry:'north'}),
  ]);
  const graph=diagram(scenario({files:[source.path]}),[source,target]);
  assert.equal(graph.edges.length,3);
  assert.equal(new Set(graph.edges.map(edge=>edge.id)).size,3);
  assert.deepEqual(graph.edges.map(edge=>edge.sourceHandle),['exit:peaceful','exit:escape','exit:follow']);
  assert.deepEqual(graph.edges.map(edge=>edge.targetHandle),['entry:north','entry:south','entry:north']);
  assert.deepEqual(sourceNodes(graph).find(node=>node.data.path===source.path).data.exits.map(port=>port.id),['peaceful','escape','follow']);
});

test('cyclic destination links terminate with one card per file and retain every source exit',()=>{
  const first=content('Scenes/A.kmscene','a','scene',[node('entry','start'),node('onward','exit',{file:'Maps/B.kmmap',entry:'entry'})]);
  const second=content('Maps/B.kmmap','b','map',[node('entry','start'),node('return','exit',{file:first.path,entry:'entry'})]);
  const graph=diagram(scenario({entry:{file:first.path,entry:'entry'},files:[first.path,second.path,first.path]}),[first,second]);
  assert.equal(graph.nodes.length,3);
  assert.equal(sourceNodes(graph).length,2);
  assert.equal(graph.edges.length,3);
  assert.equal(graph.edges.filter(edge=>edge.data.exitId==='return').length,1);
});

test('missing destinations and missing named entries create explicit unresolved placeholders',()=>{
  const destination=content('Scenes/Destination.kmscene','destination','scene',[node('front','start')]);
  const source=content('Scenes/Source.kmscene','source','scene',[
    node('start','start'),
    node('missing-file','exit',{file:'Maps/Absent.kmmap',entry:'entry'}),
    node('missing-input','exit',{file:destination.path,entry:'removed'}),
    node('missing-id','exit',{next:'unknown-scene',entry:'entry'}),
    node('unassigned','exit'),
  ]);
  const graph=diagram(scenario({files:[source.path]}),[source,destination]);
  assert.equal(graph.edges.length,3);
  assert.equal(graph.nodes.filter(node=>node.data.kind==='missing').length,3);
  for(const edge of graph.edges){
    assert.ok(edge.data.warning);
    assert.equal(edge.targetHandle,'entry:missing');
    assert.equal(graph.nodes.find(node=>node.id===edge.target).data.kind,'missing');
  }
  assert.ok(sourceNodes(graph).some(node=>node.data.path===destination.path));
  assert.match(graph.edges.find(edge=>edge.data.exitId==='missing-file').data.warning,/file not found/);
  assert.match(graph.edges.find(edge=>edge.data.exitId==='missing-id').data.warning,/No scene or map file/);
});

test('a legacy next id resolves only a unique content file and still requires its exact input',()=>{
  const target=content('Scenes/Destination.kmscene','destination','scene',[node('front','start')]);
  const source=content('Scenes/Source.kmscene','source','scene',[
    node('start','start'),node('known-entry','exit',{next:'destination',entry:'front'}),node('no-entry','exit',{next:'destination'}),
  ]);
  const graph=diagram(scenario({files:[source.path]}),[source,target]);
  const resolved=graph.edges.find(edge=>edge.data.exitId==='known-entry');
  assert.equal(resolved.target,`file:${target.path}`);
  assert.equal(resolved.targetHandle,'entry:front');
  assert.equal(resolved.data.warning,undefined);
  assert.match(graph.edges.find(edge=>edge.data.exitId==='no-entry').data.warning,/Choose a named entry/);
});

test('ambiguous document ids never silently select a destination; explicit paths disambiguate',()=>{
  const first=content('Scenes/First.kmscene','duplicate','scene',[node('entry','start')]);
  const second=content('Scenes/Second.kmscene','duplicate','scene',[node('entry','start')]);
  const source=content('Scenes/Source.kmscene','source','scene',[
    node('start','start'),node('ambiguous','exit',{next:'duplicate',entry:'entry'}),
    node('explicit','exit',{file:second.path,next:'duplicate',entry:'entry'}),
  ]);
  const graph=diagram(scenario({files:[source.path]}),[source,first,second]);
  const ambiguous=graph.edges.find(edge=>edge.data.exitId==='ambiguous');
  assert.match(ambiguous.data.warning,/More than one file/);
  assert.equal(graph.nodes.find(node=>node.id===ambiguous.target).data.kind,'missing');
  assert.equal(graph.edges.find(edge=>edge.data.exitId==='explicit').target,`file:${second.path}`);
  assert.ok(!sourceNodes(graph).some(node=>node.data.path===first.path));
});

test('invalid source files retain their error instead of creating replacement content',()=>{
  const broken={path:'Scenes/Broken.kmscene',error:'Invalid JSON: expected a closing brace'};
  const source=content('Scenes/Source.kmscene','source','scene',[node('entry','start'),node('broken','exit',{file:broken.path,entry:'entry'})]);
  const graph=diagram(scenario({files:[broken.path,source.path]}),[broken,source]);
  const root=graph.nodes.find(node=>node.id===`file:${broken.path}`);
  assert.equal(root.data.kind,'missing');
  assert.equal(root.data.warning,broken.error);
  assert.equal(graph.edges[0].data.warning,broken.error);
});

test('scenario Start rejects an unavailable input or a map instead of drawing a valid-looking launch',()=>{
  const scene=content('Scenes/Arrival.kmscene','arrival','scene',[node('front','start')]);
  const map=content('Maps/Square.kmmap','square','map',[node('north','start')]);
  for(const entry of [{file:scene.path,entry:'removed'},{file:map.path,entry:'north'},{file:'Missing.kmscene',entry:'entry'}]){
    const graph=diagram(scenario({entry}),[scene,map]);
    const edge=graph.edges.find(edge=>edge.data.isStart);
    assert.ok(edge.data.warning);
    assert.equal(edge.targetHandle,'entry:missing');
    assert.equal(graph.nodes.find(node=>node.id===edge.target).data.kind,'missing');
    assert.equal(graph.nodes.filter(node=>node.data.kind==='start').length,1);
  }
});

test('legacy scenario edges cannot become a second routing source and derivation does not mutate files',()=>{
  const first=content('Scenes/A.kmscene','a','scene',[node('entry','start')]);
  const second=content('Scenes/B.kmscene','b','scene',[node('entry','start')]);
  const doc=scenario({});
  doc.nodes=[node('a-card','scene',{file:first.path}),node('b-card','scene',{file:second.path})];
  doc.edges=[{id:'legacy-arrow',source:'a-card',target:'b-card',label:'Old diagram only',data:{condition:'',phase:'navigation',skill:'',dc:0}}];
  const before=plain({doc,files:[first,second]});
  const graph=diagram(doc,[first,second]);
  assert.equal(sourceNodes(graph).length,2);
  assert.deepEqual(graph.edges,[]);
  assert.deepEqual(plain({doc,files:[first,second]}),before);
});

test('stored diagram positions apply to Start, source cards and unresolved references deterministically',()=>{
  const source=content('Scenes/A.kmscene','a','scene',[node('entry','start')]);
  const doc=scenario({files:[source.path,'Maps/Missing.kmmap'],positions:{
    'scenario-start':{x:-120,y:40},[source.path]:{x:800,y:-200},'file:Maps/Missing.kmmap':{x:1000,y:300},
  }});
  const graph=diagram(doc,[source]);
  assert.deepEqual(graph.nodes.find(node=>node.id==='scenario-start').position,{x:-120,y:40});
  assert.deepEqual(graph.nodes.find(node=>node.data.path===source.path).position,{x:800,y:-200});
  assert.deepEqual(graph.nodes.find(node=>node.id==='file:Maps/Missing.kmmap').position,{x:1000,y:300});
  assert.deepEqual(diagram(doc,[source]),graph);
});

test('real imported Hanged Clerk exposes its opening and five distinct unresolved authored continuations',()=>{
  const doc=model.parseDocument(readFileSync(new URL('../examples/Scenes/The%20Hanged%20Clerk.kmscene',import.meta.url),'utf8'));
  const file={path:'Scenes/The Hanged Clerk.kmscene',document:doc};
  const graph=diagram(scenario({entry:{file:file.path,entry:'yard'}}),[file]);
  const card=sourceNodes(graph)[0];
  assert.equal(card.data.entries.find(entry=>entry.id==='yard').legacy,true);
  assert.equal(card.data.exits.length,5);
  const sourceEdges=graph.edges.filter(edge=>edge.data.sourcePath===file.path);
  assert.equal(sourceEdges.length,5);
  assert.equal(new Set(sourceEdges.map(edge=>edge.sourceHandle)).size,5);
  assert.ok(sourceEdges.every(edge=>edge.data.warning.includes('caerwyn-afternoon')));
  assert.equal(graph.nodes.filter(node=>node.data.kind==='missing').length,1);
  assert.equal(new Set(sourceEdges.map(edge=>edge.target)).size,1);
  assert.equal(graph.edges.find(edge=>edge.data.isStart).targetHandle,'entry:yard');
});
