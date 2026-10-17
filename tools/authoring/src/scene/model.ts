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

/** The scene with a node's data changed by `change`. */
export function updateNode(doc:SceneDocument,id:string,change:(data:NodeData)=>NodeData):SceneDocument{
  return {...doc,nodes:doc.nodes.map(node=>node.id===id?{...node,data:change(node.data)}:node)};
}

/** The scene with one field of a node's data set (undefined takes it out), where its kind's order puts it. */
export function setNodeField(doc:SceneDocument,id:string,key:string,value:unknown):SceneDocument{
  return updateNode(doc,id,data=>withKey(data,key,value,ORDER[data.kind]));
}

/** The scene with a route changed by `change`. */
export function updateRoute(doc:SceneDocument,id:string,change:(route:Route)=>Route):SceneDocument{
  return {...doc,edges:doc.edges.map(route=>route.id===id?change(route):route)};
}

/** The scene with one field of a route's data set (undefined takes it out). */
export function setRouteField(doc:SceneDocument,id:string,key:string,value:unknown):SceneDocument{
  return updateRoute(doc,id,route=>({...route,data:withKey(route.data,key,value,ORDER.route)}));
}

/** The scene with a person of the cast changed by `change`. */
export function updateCast(doc:SceneDocument,id:string,change:(member:CastMember)=>CastMember):SceneDocument{
  return {...doc,cast:doc.cast.map(member=>member.id===id?change(member):member)};
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
  const free=uniqueId(slugOf(id)||slugOf(sentence)||'fact',Object.keys(facts));
  return {doc:setSceneField(doc,'facts',{...facts,[free]:sentence}),id:free};
}

/** A fact taken out, and every beat's and route's establishes of it (the game refuses a file that settles a fact it hasn't got). */
export function removeFact(doc:SceneDocument,id:string):SceneDocument{
  const facts=Object.fromEntries(Object.entries(doc.facts??{}).filter(([fact])=>fact!==id));
  const without=(list:string[]|undefined)=>list?.includes(id)?optionalList(list.filter(fact=>fact!==id)):list;
  const nodes=doc.nodes.map(node=>{
    if(!isBeat(node)||!node.data.establishes?.includes(id))return node;
    return {...node,data:withKey(node.data,'establishes',without(node.data.establishes),ORDER.beat)};
  });
  const edges=doc.edges.map(route=>route.data.establishes?.includes(id)?{...route,data:withKey(route.data,'establishes',without(route.data.establishes),ORDER.route)}:route);
  return setSceneField({...doc,nodes,edges},'facts',Object.keys(facts).length?facts:undefined);
}

/** Where a fact is settled: the beats and routes that establish it. */
export function settlersOf(doc:SceneDocument,fact:string):string[]{
  return [...doc.nodes.filter(node=>isBeat(node)&&node.data.establishes?.includes(fact)).map(node=>node.id),...doc.edges.filter(route=>route.data.establishes?.includes(fact)).map(route=>route.id)];
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
