// The plugin's model of a scene file: the game's own format (docs/scene-format.md, .kmscene version 2),
// read with the game's parse and held to the game's rules (shared/scene), edited as the plain JSON it is.
import {EXIT_KINDS,RESULTS,STRENGTHS,isBeat,isDiscovery,isEnding,isStart,parseScene,shapeProblems} from '../../../../shared/scene/document.ts';
import type {BeatData,CastMember,EndingData,NodeData,Path,Route,SceneDocument,SceneNode,StartData} from '../../../../shared/scene/document.ts';
import {SKILLS} from '../../../../shared/scene/types.ts';
import type {Skill} from '../../../../shared/scene/types.ts';
import {SLUG,sceneRuleProblems,sceneStoryProblems} from '../../../../shared/scene/rules.ts';
import type {ProblemAt,SceneContext,SceneProblem} from '../../../../shared/scene/rules.ts';

export {EXIT_KINDS,RESULTS,SKILLS,STRENGTHS,SLUG,isBeat,isDiscovery,isEnding,isStart};
export type {BeatData,CastMember,EndingData,NodeData,Path,ProblemAt,Route,SceneContext,SceneDocument,SceneNode,SceneProblem,Skill,StartData};

/**
 * A scene file is the game's: the plugin opens it with the game's parse (shared/scene/document.ts),
 * and writes it back as the same JSON, two-space indented with a closing newline, as every scene of
 * the campaign is. The document is never rebuilt: an edit replaces one value of one object, keeping
 * every other key where it was (unknown keys too), and a key that's new goes where the format puts
 * it. So a scene loaded and saved with no edits is the same bytes.
 */

/** What a .kmscene file holds, as the plugin opens it: a scene to edit, or a version 1 file to show read-only. */
export type SceneFile={kind:'scene';doc:SceneDocument}|{kind:'v1';title:string;nodes:number;routes:number};

/** A file that can't be opened: every problem the game's parse found, or why it isn't JSON. */
export class SceneOpenError extends Error{
  constructor(readonly problems:string[]){super(problems.slice(0,6).join('; ')+(problems.length>6?`; and ${problems.length-6} more`:''))}
}

/** A .kmscene file's text, as the plugin opens it. A version 1 file (the plugin's old graph) opens read-only: the format has moved on. */
export function openSceneFile(raw:string):SceneFile{
  let value:unknown;
  try{value=JSON.parse(raw)}catch(error){throw new SceneOpenError([`it isn't JSON (${(error as Error).message})`])}
  const legacy=value as {format?:unknown;version?:unknown;kind?:unknown;title?:unknown;nodes?:unknown;edges?:unknown};
  if(legacy&&typeof legacy==='object'&&legacy.format==='kingmaker'&&legacy.version===1&&legacy.kind==='scene'){
    return {kind:'v1',title:typeof legacy.title==='string'?legacy.title:'',nodes:Array.isArray(legacy.nodes)?legacy.nodes.length:0,routes:Array.isArray(legacy.edges)?legacy.edges.length:0};
  }
  try{return {kind:'scene',doc:parseScene(raw)}}
  catch(error){throw new SceneOpenError((error as {problems?:string[]}).problems??[(error as Error).message])}
}

/** A scene as its file has it. */
export const serializeScene=(doc:SceneDocument):string=>JSON.stringify(doc,null,2)+'\n';

/** What's wrong with a scene's shape (the game's parse): [] when the game can load it. An edit that would leave any is refused. */
export const shapeOf=(doc:SceneDocument):string[]=>shapeProblems(doc);

// ---------------------------------------------------------------------------------------------
// Keys in the format's order.

/** Each object's keys in the order the format and the campaign's files have them. A key added goes where this puts it. */
export const ORDER={
  scene:['format','version','kind','id','title','description','lore','time','place','interlude','rest','milestone','hook','setting','premise','truth','clock','limits','known','cast','facts','background','assumes','overtaken','onEnd','afterwards','fronts','companion','nodes','edges'],
  cast:['id','name','called','aka','lore','look','voice','wants','fears','whyHere','knows','secrets','attitude','limits','roles','enters','group','statblock','weapon','members'],
  start:['kind','title','description','cast','lore'],
  beat:['kind','title','description','revelation','paths','required','cast','pressure','establishes','carry','lore'],
  exit:['kind','title','description','closing','result','exitKind','next','effects','lore'],
  route:['condition','phase','requires','skill','dc','onFailure','establishes'],
  path:['via','clue','earn','strength','check'],
  check:['skill','dc'],
  carry:['unlocks','later','things'],
  roles:['characterise','inconsistency','hooks'],
  member:['id','name','statblock','weapon','look'],
} as const;

/**
 * An object with `key` set to `value`, or taken out when `value` is undefined. A key that's there
 * keeps its place; a new one goes before the first key `order` puts after it (keys `order` doesn't
 * know stay where they are). The same object comes back when nothing changes.
 */
export function withKey<T extends object>(object:T,key:string,value:unknown,order:readonly string[]):T{
  const entries=Object.entries(object);
  const at=entries.findIndex(([k])=>k===key);
  if(value===undefined)return at<0?object:Object.fromEntries(entries.filter(([k])=>k!==key)) as T;
  if(at>=0){
    if(Object.is(entries[at][1],value))return object;
    entries[at]=[key,value];
    return Object.fromEntries(entries) as T;
  }
  const rank=(k:string)=>{const i=order.indexOf(k);return i<0?-1:i};
  const mine=rank(key);
  const before=mine<0?-1:entries.findIndex(([k])=>rank(k)>mine);
  entries.splice(before<0?entries.length:before,0,[key,value]);
  return Object.fromEntries(entries) as T;
}

/** A text that's optional in the format: empty is no key at all. */
export const optionalText=(text:string):string|undefined=>text.trim()?text:undefined;
/** A list that's optional in the format: empty is no key at all. */
export const optionalList=<T,>(list:T[]):T[]|undefined=>list.length?list:undefined;

// ---------------------------------------------------------------------------------------------
// Ids: readable slugs, made once from a title or name and never changed with it (game state keys on them).

/** A slug of a title or a name ("The Hanged Clerk" → "the-hanged-clerk"), or "" when it has no letters or digits. */
export function slugOf(text:string):string{
  return text.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48).replace(/-+$/,'');
}

/** `base`, or `base-2`, `base-3`… whichever isn't taken. */
export function uniqueId(base:string,taken:Iterable<string>):string{
  const used=new Set(taken),root=base||'node';
  if(!used.has(root))return root;
  for(let n=2;;n++)if(!used.has(`${root}-${n}`))return `${root}-${n}`;
}

// ---------------------------------------------------------------------------------------------
// Reading a scene.

/** A node's kind as the editor draws it: the start, a discovery (a beat with a revelation), an event (one without), an ending. */
export type NodeKind='start'|'discovery'|'event'|'ending';
export function nodeKind(node:SceneNode):NodeKind{
  if(isStart(node))return 'start';
  if(isEnding(node))return 'ending';
  return isDiscovery(node)?'discovery':'event';
}

/** The events: beats without a revelation, where the scene's stage moves and people arrive. */
export const eventsOf=(doc:SceneDocument):SceneNode<BeatData>[]=>doc.nodes.filter(isBeat).filter(node=>node.data.revelation===undefined);

/** The routes between one pair of nodes, in one direction: the graph draws them as one connection. */
export type Connection={id:string;source:string;target:string;routes:Route[]};
export const connectionId=(source:string,target:string):string=>`connection:${JSON.stringify([source,target])}`;
export function connectionsOf(edges:Route[]):Connection[]{
  const groups=new Map<string,Connection>();
  for(const route of edges){
    const id=connectionId(route.source,route.target);
    const group=groups.get(id);
    if(group)group.routes.push(route);
    else groups.set(id,{id,source:route.source,target:route.target,routes:[route]});
  }
  return [...groups.values()];
}

/** The node's title, by its id (the id when there's no such node). */
export const titleOf=(doc:SceneDocument,id:string):string=>doc.nodes.find(node=>node.id===id)?.data.title||id;

// ---------------------------------------------------------------------------------------------
// Edits. Each takes a scene and returns a new one, the given one unchanged.

/** The scene with a top-level field set (undefined takes it out). */
export const setSceneField=(doc:SceneDocument,key:string,value:unknown):SceneDocument=>withKey(doc,key,value,ORDER.scene);

/** The scene with a node's data changed by `change` (the same scene when nothing changes, so a no-op is no step of undo). */
export function updateNode(doc:SceneDocument,id:string,change:(data:NodeData)=>NodeData):SceneDocument{
  let changed=false;
  const nodes=doc.nodes.map(node=>{
    if(node.id!==id)return node;
    const data=change(node.data);
    if(data===node.data)return node;
    changed=true;
    return {...node,data};
  });
  return changed?{...doc,nodes}:doc;
}

/** The scene with one field of a node's data set (undefined takes it out), where its kind's order puts it. */
export function setNodeField(doc:SceneDocument,id:string,key:string,value:unknown):SceneDocument{
  return updateNode(doc,id,data=>withKey(data,key,value,ORDER[data.kind]));
}

/** The scene with a route changed by `change` (the same scene when nothing changes). */
export function updateRoute(doc:SceneDocument,id:string,change:(route:Route)=>Route):SceneDocument{
  let changed=false;
  const edges=doc.edges.map(route=>{if(route.id!==id)return route;const next=change(route);if(next!==route)changed=true;return next});
  return changed?{...doc,edges}:doc;
}

/** The scene with one field of a route's data set (undefined takes it out). */
export function setRouteField(doc:SceneDocument,id:string,key:string,value:unknown):SceneDocument{
  return updateRoute(doc,id,route=>{const data=withKey(route.data,key,value,ORDER.route);return data===route.data?route:{...route,data}});
}

/** The scene with a person of the cast changed by `change` (the same scene when nothing changes). */
export function updateCast(doc:SceneDocument,id:string,change:(member:CastMember)=>CastMember):SceneDocument{
  let changed=false;
  const cast=doc.cast.map(member=>{if(member.id!==id)return member;const next=change(member);if(next!==member)changed=true;return next});
  return changed?{...doc,cast}:doc;
}

/** The scene with one field of a person's card set (undefined takes it out). */
export function setCastField(doc:SceneDocument,id:string,key:string,value:unknown):SceneDocument{
  return updateCast(doc,id,member=>withKey(member,key,value,ORDER.cast));
}

/** What a new node is: a discovery, an event or an ending. */
export type NewNodeKind='discovery'|'event'|'ending';

/** A new node's data: the fields its kind must have, empty for the author to write. */
export function newNodeData(kind:NewNodeKind,title:string):NodeData{
  if(kind==='discovery')return {kind:'beat',title,description:'',revelation:'',paths:[],lore:[]};
  if(kind==='event')return {kind:'beat',title,description:'',lore:[]};
  return {kind:'exit',title,description:'',closing:'',result:'good',exitKind:'progress',lore:[]};
}

/** A card's size on the graph before it's been measured: about a node card's, in the graph's units. */
export const CARD_SIZE={width:260,height:180};

/**
 * Where a new card goes: at `want` when no card is there, else straight below it, just clear of the
 * cards in the way (each its measured size, or about a card's), so a node added beside another (a
 * second discovery from the start) never lands on top of it.
 */
export function freePosition(doc:SceneDocument,want:{x:number;y:number},sizes:Record<string,{width:number;height:number}|undefined>={},size=CARD_SIZE,gap=40):{x:number;y:number}{
  const boxes=doc.nodes.map(node=>({x:node.position.x,y:node.position.y,...(sizes[node.id]??CARD_SIZE)}));
  const clear=(y:number)=>boxes.every(box=>want.x+size.width+gap<=box.x||box.x+box.width+gap<=want.x||y+size.height+gap<=box.y||box.y+box.height+gap<=y);
  let y=want.y;
  // Each step lands just below the lowest card in the way, so it ends below a column of them.
  for(let tries=0;tries<500&&!clear(y);tries++){
    const blocking=boxes.filter(box=>!(want.x+size.width+gap<=box.x||box.x+box.width+gap<=want.x||y+size.height+gap<=box.y||box.y+box.height+gap<=y));
    y=Math.max(...blocking.map(box=>box.y+box.height+gap));
  }
  return {x:Math.round(want.x),y:Math.round(y)};
}

/**
 * A node added: its id a slug of its title (or the one asked for) that's free in the scene, and, from
 * `from` when it's given and isn't an ending, a route to it. Returns the scene and the new ids.
 */
export function addNode(doc:SceneDocument,kind:NewNodeKind,title:string,position:{x:number;y:number},options:{id?:string;from?:string}={}):{doc:SceneDocument;id:string;route?:string}{
  const id=uniqueId(slugOf(options.id??'')||slugOf(title)||kind,doc.nodes.map(node=>node.id));
  const node:SceneNode={id,type:'story',position:{x:Math.round(position.x),y:Math.round(position.y)},data:newNodeData(kind,title)};
  const added={...doc,nodes:[...doc.nodes,node]};
  const from=options.from===undefined?undefined:doc.nodes.find(other=>other.id===options.from);
  if(!from||isEnding(from))return {doc:added,id};
  const routed=addRoute(added,from.id,id);
  return {doc:routed.doc,id,route:routed.id};
}

/**
 * A route added between two nodes, its id and label made from where it goes ("find-murder" into a
 * discovery, "to-cart-arrives" otherwise, free in the scene). Into an event it's a cue (the moment the
 * co-GM brings about); otherwise it's judged on what has happened.
 */
export function addRoute(doc:SceneDocument,source:string,target:string):{doc:SceneDocument;id:string}{
  const to=doc.nodes.find(node=>node.id===target);
  const kind=to?nodeKind(to):'event';
  const id=uniqueId(`${kind==='discovery'?'find':'to'}-${target}`,doc.edges.map(route=>route.id));
  const title=to?.data.title||target;
  const route:Route={id,source,target,type:'smoothstep',label:kind==='discovery'?`Find ${title}`:title,data:{condition:'',phase:kind==='event'?'cue':'outcome',skill:'',dc:12}};
  return {doc:{...doc,edges:[...doc.edges,route]},id};
}

/** A route like another (the same ends), added beside it with an id of its own. */
export function addSiblingRoute(doc:SceneDocument,like:Route):{doc:SceneDocument;id:string}{
  return addRoute(doc,like.source,like.target);
}

/**
 * Nodes taken out, with every route to or from them, and what named them: a route's requires and its
 * onFailure, and who entered at one. The start stays: a scene has exactly one.
 */
export function removeNodes(doc:SceneDocument,ids:Iterable<string>):SceneDocument{
  const gone=new Set([...ids].filter(id=>!doc.nodes.some(node=>node.id===id&&isStart(node))));
  if(!gone.size)return doc;
  const edges=doc.edges.filter(route=>!gone.has(route.source)&&!gone.has(route.target)).map(route=>{
    let data=route.data;
    if(data.requires?.some(id=>gone.has(id)))data=withKey(data,'requires',optionalList(data.requires.filter(id=>!gone.has(id))),ORDER.route);
    if(data.onFailure!==undefined&&gone.has(data.onFailure))data=withKey(data,'onFailure',undefined,ORDER.route);
    return data===route.data?route:{...route,data};
  });
  const cast=doc.cast.map(member=>member.enters!==undefined&&gone.has(member.enters)?withKey(member,'enters',undefined,ORDER.cast):member);
  return {...doc,nodes:doc.nodes.filter(node=>!gone.has(node.id)),edges,cast};
}

/** Routes moved: each leaves from (`source`) or goes to (`target`) another node, its id and the rest of it as they were. */
export function moveRoutes(doc:SceneDocument,ids:Iterable<string>,side:'source'|'target',node:string):SceneDocument{
  const moving=new Set(ids);
  return {...doc,edges:doc.edges.map(route=>moving.has(route.id)&&route[side]!==node?{...route,[side]:node}:route)};
}

/** Routes taken out, and what else named them: nothing does. */
export function removeRoutes(doc:SceneDocument,ids:Iterable<string>):SceneDocument{
  const gone=new Set(ids);
  return {...doc,edges:doc.edges.filter(route=>!gone.has(route.id))};
}

/** A person added to the cast: the fields a card must have, empty for the author, and an id free in the cast. */
export function addCast(doc:SceneDocument,name:string,id?:string):{doc:SceneDocument;id:string}{
  const free=uniqueId(slugOf(id??'')||slugOf(name)||'person',doc.cast.map(member=>member.id));
  const member:CastMember={id:free,name,look:'',voice:'',wants:'',whyHere:'',knows:[],attitude:''};
  return {doc:{...doc,cast:[...doc.cast,member]},id:free};
}

/** A person taken out of the cast, with the notes the start and the events kept for them. What else names them (a path's via, an effect) stays, for the problems to say. */
export function removeCast(doc:SceneDocument,id:string):SceneDocument{
  const nodes=doc.nodes.map(node=>{
    const notes='cast' in node.data?node.data.cast:undefined;
    if(!notes||!(id in notes))return node;
    const rest=Object.fromEntries(Object.entries(notes).filter(([who])=>who!==id));
    return {...node,data:withKey(node.data,'cast',Object.keys(rest).length?rest:undefined,ORDER[node.data.kind])};
  });
  return {...doc,cast:doc.cast.filter(member=>member.id!==id),nodes};
}

/** Who arrives at an event: those whose `enters` it is. Setting someone's moves them from wherever they entered before. */
export function setArrival(doc:SceneDocument,castId:string,eventId:string,arrives:boolean):SceneDocument{
  return updateCast(doc,castId,member=>{
    if(arrives)return withKey(member,'enters',eventId,ORDER.cast);
    return member.enters===eventId?withKey(member,'enters',undefined,ORDER.cast):member;
  });
}

/** A fact added: its id (a slug, free among the facts) and the sentence the GM is told when it's settled. */
export function addFact(doc:SceneDocument,id:string,sentence:string):{doc:SceneDocument;id:string}{
  const facts=doc.facts??{};
  const free=newFactId(doc,id,sentence);
  return {doc:setSceneField(doc,'facts',{...facts,[free]:sentence}),id:free};
}

/** The id a new fact gets: a slug of the id asked for (or of its sentence), free among the scene's facts. */
export const newFactId=(doc:SceneDocument,id:string,sentence:string):string=>uniqueId(slugOf(id)||slugOf(sentence)||'fact',Object.keys(doc.facts??{}));

/**
 * A fact taken out, and every place that names it: each beat's and route's establishes (the game
 * refuses a file that settles a fact it hasn't got) and each effect's condition on it (onEnd's and the
 * endings'; a condition left with no fact goes).
 */
export function removeFact(doc:SceneDocument,id:string):SceneDocument{
  const facts=Object.fromEntries(Object.entries(doc.facts??{}).filter(([fact])=>fact!==id));
  const next=changeFactReferences(doc,list=>list.filter(fact=>fact!==id));
  return setSceneField(next,'facts',Object.keys(facts).length?facts:undefined);
}

/** A fact's id changed, where its key is among the facts, and in every establishes and condition naming it. */
export function renameFact(doc:SceneDocument,from:string,to:string):SceneDocument{
  if(from===to||!doc.facts||!(from in doc.facts))return doc;
  const facts=Object.fromEntries(Object.entries(doc.facts).map(([fact,sentence])=>[fact===from?to:fact,sentence]));
  return setSceneField(changeFactReferences(doc,list=>list.map(fact=>fact===from?to:fact)),'facts',facts);
}

/** Every list of facts in the scene changed by `change`: the beats' and routes' establishes, and the effects' conditions. Unchanged parts stay the same objects. */
function changeFactReferences(doc:SceneDocument,change:(facts:string[])=>string[]):SceneDocument{
  const same=(a:string[],b:string[])=>a.length===b.length&&a.every((fact,i)=>fact===b[i]);
  const establishes=<T extends {establishes?:string[]}>(data:T,order:readonly string[]):T=>{
    if(!data.establishes)return data;
    const next=change(data.establishes);
    return same(next,data.establishes)?data:withKey(data,'establishes',optionalList(next),order);
  };
  const nodes=doc.nodes.map(node=>{
    let data=node.data;
    if(isBeat(node))data=establishes(node.data,ORDER.beat);
    if(isEnding(node)&&node.data.effects){
      const effects=node.data.effects.map(effect=>withFactsChanged(effect as EffectLike,change)) as EndingData['effects'];
      if(effects!.some((effect,i)=>effect!==node.data.effects![i]))data=withKey(node.data,'effects',effects,ORDER.exit);
    }
    return data===node.data?node:{...node,data};
  });
  const edges=doc.edges.map(route=>{const data=establishes(route.data,ORDER.route);return data===route.data?route:{...route,data}});
  let next:SceneDocument={...doc,nodes,edges};
  if(doc.onEnd){
    const onEnd=doc.onEnd.map(effect=>withFactsChanged(effect as EffectLike,change));
    if(onEnd.some((effect,i)=>effect!==doc.onEnd![i]))next=setSceneField(next,'onEnd',onEnd);
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Effects: an op and its fields, kept whole (shared/scene/files.ts Effect), and their conditions on facts.

/** An effect as the file has it. */
export type EffectLike={op:string;[key:string]:unknown};
export type ConditionKey='if'|'unless';

/** An effect's facts in a condition (`if` or `unless`): one id or several. */
export function factsIn(condition:unknown):string[]{
  const established=(condition as {established?:unknown}|undefined)?.established;
  return typeof established==='string'?[established]:Array.isArray(established)?established.filter((id):id is string=>typeof id==='string'):[];
}

/** A condition on facts as the files write it: one fact as its id, several as a list, none as no condition. */
export const conditionOf=(facts:string[]):{established:string|string[]}|undefined=>facts.length===0?undefined:{established:facts.length===1?facts[0]:facts};

/** An effect with its conditions' facts changed by `change` (the same effect when nothing changes). A condition keeps its other keys; one with no fact left goes. */
export function withFactsChanged(effect:EffectLike,change:(facts:string[])=>string[]):EffectLike{
  let next=effect;
  for(const key of ['if','unless'] as const){
    const condition=next[key];
    if(condition===undefined)continue;
    const facts=factsIn(condition),changed=change(facts);
    if(changed.length===facts.length&&changed.every((fact,i)=>fact===facts[i]))continue;
    // A list stays a list when only its ids change; a fact taken out leaves one fact as its id, or none.
    const established=(condition as {established?:unknown}).established;
    const value=changed.length===0?undefined:Array.isArray(established)&&changed.length===facts.length?changed:conditionOf(changed)!.established;
    const rest=withKey(condition as object,'established',value,['established']);
    next=withKey(next,key,value===undefined&&!Object.keys(rest).length?undefined:rest,EFFECT_ORDER);
  }
  return next;
}

/** An effect's keys in the order the campaign's files have them: the op, what it names, its words, then its conditions. */
export const EFFECT_ORDER=['op','quest','do','title','stage','name','value','who','by','enemies','allies','what','kind','to','how','at','feet','quantity','text','add','remove','if','unless'] as const;

/** Where a fact is settled: the beats and routes that establish it. */
export function settlersOf(doc:SceneDocument,fact:string):string[]{
  return [...doc.nodes.filter(node=>isBeat(node)&&node.data.establishes?.includes(fact)).map(node=>node.id),...doc.edges.filter(route=>route.data.establishes?.includes(fact)).map(route=>route.id)];
}

/** Where a fact is settled, each a beat or a route. */
export type FactSettler={kind:'node';id:string}|{kind:'route';id:string};
export function settlesOf(doc:SceneDocument,fact:string):FactSettler[]{
  return [
    ...doc.nodes.filter(node=>isBeat(node)&&node.data.establishes?.includes(fact)).map(node=>({kind:'node' as const,id:node.id})),
    ...doc.edges.filter(route=>route.data.establishes?.includes(fact)).map(route=>({kind:'route' as const,id:route.id})),
  ];
}

/** Where a fact is tested: an effect's condition (if or unless), in an ending's effects or the scene's onEnd. */
export type FactTest={at:{kind:'node';id:string}|{kind:'scene';field:'onEnd'};index:number;key:ConditionKey;op:string};
export function testsOf(doc:SceneDocument,fact:string):FactTest[]{
  const tests:FactTest[]=[];
  const look=(at:FactTest['at'],effects:readonly unknown[]|undefined)=>(effects??[]).forEach((effect,index)=>{
    for(const key of ['if','unless'] as const)if(factsIn((effect as EffectLike)[key]).includes(fact))tests.push({at,index,key,op:(effect as EffectLike).op});
  });
  look({kind:'scene',field:'onEnd'},doc.onEnd);
  for(const node of doc.nodes.filter(isEnding))look({kind:'node',id:node.id},node.data.effects);
  return tests;
}

// ---------------------------------------------------------------------------------------------
// Ids: renamed only by asking, every reference in the file following. Game state keys on them, so a
// scene already played loses track of what it knew by the old one.

/** Why an id can't be used, or undefined when it can: a slug, not one of `taken` (`current`, its own, aside). */
export function idProblem(id:string,taken:Iterable<string>,current?:string):string|undefined{
  if(!SLUG.test(id))return 'An id is a slug: lower-case letters, digits and dashes, starting with a letter or digit.';
  if(id!==current&&[...taken].includes(id))return `${id} is taken.`;
  return undefined;
}

/** A node's id changed, and everything naming it: the routes' ends, what they require and where they fail to, and who arrives there. */
export function renameNode(doc:SceneDocument,from:string,to:string):SceneDocument{
  if(from===to||!doc.nodes.some(node=>node.id===from))return doc;
  const swap=(id:string)=>id===from?to:id;
  const nodes=doc.nodes.map(node=>node.id===from?{...node,id:to}:node);
  const edges=doc.edges.map(route=>{
    let next=route;
    if(route.source===from||route.target===from)next={...next,source:swap(route.source),target:swap(route.target)};
    let data=next.data;
    if(data.requires?.includes(from))data=withKey(data,'requires',data.requires.map(swap),ORDER.route);
    if(data.onFailure===from)data=withKey(data,'onFailure',to,ORDER.route);
    return data===next.data?next:{...next,data};
  });
  const cast=doc.cast.map(member=>member.enters===from?withKey(member,'enters',to,ORDER.cast):member);
  return {...doc,nodes,edges,cast};
}

/** A route's id changed: nothing else in the file names a route (the co-GM moves the scene by it, and game state keys on it). */
export function renameRoute(doc:SceneDocument,from:string,to:string):SceneDocument{
  if(from===to)return doc;
  return {...doc,edges:doc.edges.map(route=>route.id===from?withKey(route,'id',to,['id']):route)};
}

/**
 * A person's id changed, and everything in the file naming them: the start's and events' notes for
 * them (in their place), the paths via them, the effects naming them (who, a promise's by and to, a
 * fight's allies and leaders, a world op's what and to, in onEnd, the endings' effects and afterwards)
 * and the talk template's companion. Files outside the scene that name them (the place's people,
 * looks.json) are the campaign's: the problems say where.
 */
export function renameCast(doc:SceneDocument,from:string,to:string):SceneDocument{
  if(from===to||!doc.cast.some(member=>member.id===from))return doc;
  const cast=doc.cast.map(member=>member.id===from?withKey(member,'id',to,ORDER.cast):member);
  const nodes=doc.nodes.map(node=>{
    let data=node.data;
    const notes='cast' in data?data.cast:undefined;
    if(notes&&from in notes)data=withKey(data,'cast',Object.fromEntries(Object.entries(notes).map(([who,note])=>[who===from?to:who,note])),ORDER[data.kind]);
    if(isBeat(node)&&node.data.paths?.some(path=>path.via===from))data=withKey(data,'paths',node.data.paths.map(path=>path.via===from?withKey(path,'via',to,ORDER.path):path),ORDER.beat);
    if(isEnding(node)&&node.data.effects){
      const effects=node.data.effects.map(effect=>effectRenamingPerson(effect as EffectLike,from,to));
      if(effects.some((effect,i)=>effect!==node.data.effects![i]))data=withKey(data,'effects',effects,ORDER.exit);
    }
    return data===node.data?node:{...node,data};
  });
  let next:SceneDocument={...doc,cast,nodes};
  for(const key of ['onEnd','afterwards'] as const){
    const list=doc[key] as EffectLike[]|undefined;
    if(!list)continue;
    const changed=list.map(effect=>effectRenamingPerson(effect,from,to));
    if(changed.some((effect,i)=>effect!==list[i]))next=setSceneField(next,key,changed);
  }
  if(doc.companion===from)next=setSceneField(next,'companion',to);
  return next;
}

/** An effect naming a person by another id (the same effect when it doesn't name them). */
function effectRenamingPerson(effect:EffectLike,from:string,to:string):EffectLike{
  let next=effect;
  for(const key of ['who','by','to','what']){if(next[key]===from)next=withKey(next,key,to,EFFECT_ORDER)}
  if(Array.isArray(next.allies)&&next.allies.includes(from))next=withKey(next,'allies',(next.allies as unknown[]).map(who=>who===from?to:who),EFFECT_ORDER);
  if(Array.isArray(next.enemies)&&next.enemies.some(enemy=>(enemy as {leader?:unknown})?.leader===from))
    next=withKey(next,'enemies',(next.enemies as Array<Record<string,unknown>>).map(enemy=>enemy?.leader===from?withKey(enemy,'leader',to,['asset','count','leader']):enemy),EFFECT_ORDER);
  return next;
}

// ---------------------------------------------------------------------------------------------
// A beat's kind: a discovery has a revelation, an event hasn't.

/** A beat made an event: its revelation, its paths and its required mark go (an event has none). The rest stays. */
export function makeEvent(doc:SceneDocument,id:string):SceneDocument{
  const node=doc.nodes.find(other=>other.id===id);
  if(!node||!isDiscovery(node))return doc;
  return updateNode(doc,id,data=>{
    let next:NodeData=data;
    for(const key of ['revelation','paths','required'])next=withKey(next,key,undefined,ORDER.beat);
    return next;
  });
}

/** A beat made a discovery: an empty revelation and no paths yet; an event's pressure and conversation roles go, and whoever arrived there is here from the start. */
export function makeDiscovery(doc:SceneDocument,id:string):SceneDocument{
  const node=doc.nodes.find(other=>other.id===id);
  if(!node||!isBeat(node)||isDiscovery(node))return doc;
  const next=updateNode(doc,id,data=>{
    let beat:NodeData=withKey(withKey(data,'revelation','',ORDER.beat),'paths',(data as BeatData).paths??[],ORDER.beat);
    for(const key of ['pressure','cast'])beat=withKey(beat,key,undefined,ORDER.beat);
    return beat;
  });
  return {...next,cast:next.cast.map(member=>member.enters===id?withKey(member,'enters',undefined,ORDER.cast):member)};
}

// ---------------------------------------------------------------------------------------------
// A new scene.

/**
 * A new scene's file: the format's fields, empty for the author to write, and a graph to start from:
 * a start, a discovery and an ending, and a route from the start into the discovery. Its id is its
 * file's name, a slug of its title; the nodes' ids are slugs of their titles too.
 */
export function skeletonScene(title:string,id=slugOf(title)):SceneDocument{
  const start:SceneNode<StartData>={id:'start',type:'story',position:{x:0,y:0},data:{kind:'start',title:'Start',description:'',lore:[]}};
  const discovery:SceneNode<BeatData>={id:'discovery',type:'story',position:{x:400,y:0},data:{kind:'beat',title:'Discovery',description:'',revelation:'',paths:[],lore:[]}};
  const ending:SceneNode<EndingData>={id:'ending',type:'story',position:{x:800,y:0},data:{kind:'exit',title:'Ending',description:'',closing:'',result:'good',exitKind:'progress',lore:[]}};
  const route:Route={id:'find-discovery',source:'start',target:'discovery',type:'smoothstep',label:'Find Discovery',data:{condition:'',phase:'outcome',skill:'',dc:12}};
  return {
    format:'kingmaker',version:2,kind:'scene',id,title,description:'',lore:[],
    hook:'',setting:'',premise:'',truth:'',
    cast:[],
    nodes:[start,discovery,ending],
    edges:[route],
  };
}

// ---------------------------------------------------------------------------------------------
// Problems: the game's rules, as the campaign check holds the scene to them.

/** A problem as the editor lists it: the game's sentence, and where it is. */
export type Problem=SceneProblem;

/**
 * What the campaign check would say of this scene (`key`: its file's name), each problem with where it
 * is: its shape first (the editor never saves a scene the game can't load, so normally none), then
 * the format's rules and where the story goes from it.
 */
export function problemsOf(key:string,doc:SceneDocument,context:SceneContext):Problem[]{
  const shape=shapeOf(doc);
  if(shape.length)return shape.map(message=>({message,at:{kind:'scene'}}));
  const ids=new Set([...context.scenes,...(context.talk?[context.talk]:[]),...context.others.map(other=>other.id),doc.id]);
  return [...sceneRuleProblems(key,doc,context),...sceneStoryProblems(doc,ids)];
}
