import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

const output=await build({entryPoints:[new URL('../src/model.ts',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'node'});
const {parseDocument,serializeDocument,emptyDocument,removeNodes,connectionId,groupConnections,entryPorts,exitPorts,withDestination}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const raw=await readFile(new URL('./fixtures/v1/Scenes/The%20Hanged%20Clerk.kmscene',import.meta.url),'utf8');

test('real authored scene validates and roundtrips without losing source or route metadata',()=>{
  const doc=parseDocument(raw,'scene');
  assert.equal(doc.nodes.length,10);assert.equal(doc.edges.length,51);
  assert.deepEqual(parseDocument(serializeDocument(doc)),doc);
});
test('viewport selection and measurements never become authored data',()=>{
  const doc=parseDocument(raw);doc.nodes[0].selected=true;doc.nodes[0].measured={width:250,height:230};doc.nodes[0].dragging=true;
  const saved=JSON.parse(serializeDocument(doc));
  assert.equal(saved.nodes[0].selected,undefined);assert.equal(saved.nodes[0].measured,undefined);assert.equal(saved.nodes[0].dragging,undefined);
  assert.deepEqual(saved.source,doc.source);
});
test('removing a node removes only its incident edges without mutating original',()=>{
  const doc=parseDocument(raw),next=removeNodes(doc,new Set(['yard']));
  assert.equal(doc.nodes.length,10);assert.equal(next.nodes.length,9);
  assert.ok(next.edges.every(edge=>edge.source!=='yard'&&edge.target!=='yard'));
  assert.doesNotThrow(()=>parseDocument(serializeDocument(next)));
});
test('new documents are empty real file documents',()=>{
  for(const kind of ['scene','scenario','map']){const doc=emptyDocument(kind,'New file');assert.equal(doc.kind,kind);assert.equal(doc.nodes.length,0);assert.deepEqual(parseDocument(serializeDocument(doc),kind),doc)}
});
test('bad versions, kinds, duplicate ids, malformed nodes and dangling edges fail validation',()=>{
  for(const mutate of [doc=>doc.version=2,doc=>doc.kind='unknown',doc=>doc.nodes.push(doc.nodes[0]),doc=>doc.edges.push(doc.edges[0]),doc=>doc.nodes[0].position.x=null,doc=>doc.edges[0].target='missing',doc=>doc.nodes[0].data.file=42]){
    const doc=JSON.parse(raw);mutate(doc);assert.throws(()=>parseDocument(JSON.stringify(doc)));
  }
  assert.throws(()=>parseDocument(raw,'scenario'));
  assert.throws(()=>parseDocument('{invalid'));
});
test('imported branches preserve route conditions, scope and checks',()=>{
  const doc=parseDocument(raw);
  for(const edge of doc.edges){
    const route=edge.data.sourceRoute;
    assert.equal(edge.data.condition,route.when);assert.equal(edge.data.phase,route.on);
    if(route.check){assert.equal(edge.data.skill,route.check.skill);assert.equal(edge.data.dc,route.check.dc);assert.equal(edge.target,edge.data.branch==='success'?route.check.onSuccess:(route.check.onFailure??edge.source))}
    else assert.equal(edge.target,route.to??edge.source);
  }
});
test('all 51 Hanged Clerk routes appear once across 24 directed connections',()=>{
  const doc=parseDocument(raw),groups=groupConnections(doc.edges);
  assert.equal(groups.length,24);
  const members=groups.flatMap(group=>group.data.routes);
  assert.equal(members.length,51);
  assert.deepEqual(members.map(route=>route.id).sort(),doc.edges.map(route=>route.id).sort());
  assert.equal(new Set(members).size,doc.edges.length);
  for(const group of groups){
    assert.equal(group.id,connectionId(group.source,group.target));
    assert.equal(group.type,'connection');
    assert.equal(group.label,group.data.routes.length===1?'1 transition':`${group.data.routes.length} transitions`);
    assert.ok(group.data.routes.every(route=>route.source===group.source&&route.target===group.target));
    assert.deepEqual(group.data.routes,doc.edges.filter(route=>route.source===group.source&&route.target===group.target));
  }
});
test('connection ids are stable, directional and safe for delimiter-like node ids',()=>{
  const pairs=[['a','b'],['b','a'],['a:b','c'],['a','b:c'],['a,b','c'],['a','b,c'],['a\"','b'],['a','\"b'],['',''],['[]',''],['','[]'],['a','a']];
  assert.equal(new Set(pairs.map(([source,target])=>connectionId(source,target))).size,pairs.length);
  for(const [source,target] of pairs)assert.equal(connectionId(source,target),connectionId(source,target));
});
test('group order and route order follow first occurrence and self loops form one group',()=>{
  const route=(id,source,target)=>({id,source,target,label:id,data:{condition:id,phase:'attempt',skill:'',dc:0}});
  const routes=[route('first','a','b'),route('reverse','b','a'),route('second','a','b'),route('self1','a','a'),route('third','a','b'),route('self2','a','a')];
  const groups=groupConnections(routes);
  assert.deepEqual(groups.map(group=>[group.source,group.target]),[['a','b'],['b','a'],['a','a']]);
  assert.deepEqual(groups.map(group=>group.data.routes.map(route=>route.id)),[['first','second','third'],['reverse'],['self1','self2']]);
  assert.deepEqual(groupConnections([]),[]);
});
test('grouping neither mutates input routes nor introduces persisted groups',()=>{
  const doc=parseDocument(raw),before=structuredClone(doc);
  const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child)}return value};
  freeze(doc);
  const groups=groupConnections(doc.edges);
  assert.deepEqual(doc,before);
  assert.equal(groups[0].data.routes[0],doc.edges[0]);
  assert.deepEqual(parseDocument(serializeDocument(doc)),before);
});
test('adding and removing route membership roundtrips all remaining source metadata',()=>{
  const doc=parseDocument(raw),original=structuredClone(doc),member=doc.edges[0];
  const extra={...structuredClone(member),id:'new-transition-way',label:'An alternative',data:{...structuredClone(member.data),condition:'A newly authored condition',customMetadata:{nested:['retained',42]}}};
  const added={...doc,edges:[...doc.edges,extra]};
  const saved=parseDocument(serializeDocument(added));
  const originalGroup=groupConnections(doc.edges).find(group=>group.id===connectionId(member.source,member.target));
  const addedGroup=groupConnections(saved.edges).find(group=>group.id===originalGroup.id);
  assert.equal(groupConnections(saved.edges).length,groupConnections(doc.edges).length);
  assert.equal(addedGroup.data.routes.length,originalGroup.data.routes.length+1);
  assert.deepEqual(addedGroup.data.routes.at(-1),extra);
  assert.deepEqual(saved.source,doc.source);
  const removed=parseDocument(serializeDocument({...saved,edges:saved.edges.filter(route=>route.id!==extra.id)}));
  assert.deepEqual(removed,original);
  assert.deepEqual(doc,original);
});
test('exit destinations and source metadata survive generic node and transition edits',()=>{
  const doc=parseDocument(raw),before=structuredClone(doc);
  const exit=doc.nodes.find(node=>node.data.kind==='exit');
  assert.equal(exit.data.next,'caerwyn-afternoon');
  const updated={...doc,title:'Updated scene title',nodes:doc.nodes.map(node=>node.id===exit.id?{
    ...node,position:{x:node.position.x+50,y:node.position.y+20},data:{...node.data,title:'Updated ending',description:'Edited ending text',lore:[...node.data.lore,'Places/New destination.md']},
  }:node),edges:doc.edges.map((edge,index)=>index===0?{...edge,data:{...edge.data,condition:'Edited transition condition'}}:edge)};
  const saved=parseDocument(serializeDocument(updated));
  for(const node of before.nodes.filter(node=>node.data.kind==='exit')){
    const after=saved.nodes.find(candidate=>candidate.id===node.id);
    assert.equal(after.data.next,node.data.next);
    assert.equal(after.data.exitKind,node.data.exitKind);
    assert.deepEqual(after.data.effects,node.data.effects);
  }
  const destinationEdit={...saved,nodes:saved.nodes.map(node=>node.id===exit.id?{...node,data:{...node.data,next:'watch-house'}}:node)};
  assert.equal(parseDocument(serializeDocument(destinationEdit)).nodes.find(node=>node.id===exit.id).data.next,'watch-house');
  assert.deepEqual(saved.source,before.source);
  assert.deepEqual(doc,before);
});
test('multiple named starts coexist with the imported opening without mutating it',()=>{
  const doc=parseDocument(raw),before=structuredClone(doc);
  assert.deepEqual(entryPorts(doc),[{id:'yard',title:'Stones at a hanged man',legacy:true}]);
  const start=(id,title)=>({id,type:'story',position:{x:-300,y:0},data:{kind:'start',title,description:'',lore:[]}});
  const updated={...doc,nodes:[...doc.nodes,start('front','Front gate'),start('back','Back way')]};
  assert.deepEqual(entryPorts(updated).map(port=>port.id),['front','back','yard']);
  assert.deepEqual(entryPorts(parseDocument(serializeDocument(updated))),entryPorts(updated));
  assert.equal(exitPorts(updated).length,5);
  assert.deepEqual(doc,before);
});
test('destinations name an exact scene or map input and preserve source data',()=>{
  const doc=parseDocument(raw),original=structuredClone(doc);
  const map=emptyDocument('map','Market Square');map.nodes=[{id:'north',position:{x:0,y:0},data:{kind:'start',title:'North gate',description:'',lore:[]}}];
  const target={path:'Maps/Market Square.kmmap',document:map};
  const changed=withDestination(doc,'case-made',target,'north'),exit=exitPorts(changed).find(node=>node.id==='case-made');
  assert.equal(exit.data.file,target.path);assert.equal(exit.data.next,map.id);assert.equal(exit.data.entry,'north');assert.equal(exit.data.destinationKind,'map');
  assert.deepEqual(exit.data.effects,exitPorts(doc).find(node=>node.id==='case-made').data.effects);
  assert.deepEqual(changed.source,doc.source);assert.deepEqual(changed.edges,doc.edges);
  assert.deepEqual(parseDocument(serializeDocument(changed)),changed);assert.deepEqual(doc,original);
  const cleared=exitPorts(withDestination(changed,'case-made',undefined,'')).find(node=>node.id==='case-made');
  for(const key of ['file','next','entry','destinationKind'])assert.equal(cleared.data[key],undefined);
  assert.throws(()=>withDestination(doc,'yard',target,'north'));
  assert.throws(()=>withDestination(doc,'case-made',target,'missing'));
  assert.throws(()=>withDestination(doc,'case-made',{path:'Bad.kmscene',error:'Invalid JSON'},'north'));
  assert.throws(()=>withDestination(doc,'case-made',{path:'Scenario.kmscenario',document:emptyDocument('scenario','Scenario')},'north'));
});
test('scenario launch reference and layout roundtrip without adding a second transition graph',()=>{
  const doc=emptyDocument('scenario','Caerwyn');doc.scenario={entry:{file:'Scenes/The Hanged Clerk.kmscene',entry:'yard'},files:['Maps/Market Square.kmmap'],positions:{'Scenes/The Hanged Clerk.kmscene':{x:20,y:30}}};
  assert.deepEqual(parseDocument(serializeDocument(doc)),doc);assert.deepEqual(doc.edges,[]);
  for(const config of [{entry:{file:'x',entry:5}},{files:'x'},{positions:{x:{x:null,y:0}}}])assert.throws(()=>parseDocument(JSON.stringify({...doc,scenario:config})));
});
