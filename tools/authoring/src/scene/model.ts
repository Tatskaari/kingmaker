// The plugin's model of a scene file: the game's own format (docs/scene-format.md, .kmscene version 2),
// read with the game's parse and held to the game's rules (shared/scene), edited as the plain JSON it is.
import {EXIT_KINDS,RESULTS,STRENGTHS,isBeat,isDiscovery,isEnding,isStart,parseScene,shapeProblems} from '../../../../shared/scene/document.ts';
import type {BeatData,CastMember,EndingData,NodeData,OuterLimit,Path,Reinforcement,Route,SceneDocument,SceneNode,StartData} from '../../../../shared/scene/document.ts';
import {SKILLS} from '../../../../shared/scene/types.ts';
import type {Skill} from '../../../../shared/scene/types.ts';
import {SLUG,sceneRuleProblems,sceneStoryProblems,talkTemplateProblems} from '../../../../shared/scene/rules.ts';
import type {ProblemAt,SceneContext,SceneProblem} from '../../../../shared/scene/rules.ts';
import {optionalList,optionalText,slugOf,uniqueId,withKey} from '../campaign/json.ts';
import type {PlaceFile} from '../../../../shared/scene/files.ts';

export {EXIT_KINDS,RESULTS,SKILLS,STRENGTHS,SLUG,isBeat,isDiscovery,isEnding,isStart,optionalList,optionalText,slugOf,uniqueId,withKey};
export type {BeatData,CastMember,EndingData,NodeData,OuterLimit,Path,ProblemAt,Reinforcement,Route,SceneContext,SceneDocument,SceneNode,SceneProblem,Skill,StartData};

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
  scene:['format','version','kind','id','title','description','lore','time','place','interlude','rest','milestone','hook','setting','premise','truth','clock','limits','known','cast','facts','background','assumes','overtaken','onStart','onEnd','afterwards','reinforcements','fronts','companion','nodes','edges'],
  cast:['id','name','called','aka','lore','look','voice','wants','fears','whyHere','knows','secrets','attitude','limits','roles','enters','group','statblock','weapon','members'],
  start:['kind','title','description','cast','lore'],
  beat:['kind','title','description','revelation','paths','required','cast','pressure','fight','establishes','carry','lore'],
  fight:['foes','allies'],
  reinforcement:['id','name','statblock','weapon','look','after','why'],
  exit:['kind','title','description','closing','result','exitKind','next','effects','lore'],
  route:['condition','phase','requires','skill','dc','onFailure','establishes','limit'],
  limit:['exchanges','after','until'],
  path:['via','clue','earn','strength','check'],
  check:['skill','dc'],
  carry:['unlocks','later','things'],
  roles:['characterise','inconsistency','hooks'],
  member:['id','name','statblock','weapon','look'],
} as const;

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

/** Who can be on a side in a fight (an event's fight): the cast, and their groups' members, each with who they're with. */
export function fighters(doc:SceneDocument):Array<{id:string;name:string;with?:string}>{
  return doc.cast.flatMap(member=>[{id:member.id,name:member.name||member.id},...(member.members??[]).map(m=>({id:m.id,name:m.name||m.id,with:member.name||member.id}))]);
}

/** An event's fight with one side's people changed: the foes always there (none yet is a problem until there are), the allies only when there are some. */
export function setFightSide(doc:SceneDocument,id:string,side:'foes'|'allies',ids:string[]):SceneDocument{
  const node=doc.nodes.find(other=>other.id===id);
  if(!node||!isBeat(node))return doc;
  const now=node.data.fight??{foes:[]};
  const next={...now,[side]:ids};
  return setNodeField(doc,id,'fight',{foes:next.foes,...(next.allies?.length?{allies:next.allies}:{})});
}

/** Who comes when a fight breaks out, changed: none left takes the field out. */
export function setReinforcements(doc:SceneDocument,items:Reinforcement[]):SceneDocument{
  return setSceneField(doc,'reinforcements',items.length?items.map(item=>Object.fromEntries(ORDER.reinforcement.filter(key=>(item as unknown as Record<string,unknown>)[key]!==undefined).map(key=>[key,(item as unknown as Record<string,unknown>)[key]]))):undefined);
}

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
  const route:Route={id,source,target,type:'smoothstep',label:to?defaultLabelOf(to):target,data:{condition:'',phase:kind==='event'?'cue':'outcome',skill:'',dc:12}};
  return {doc:{...doc,edges:[...doc.edges,route]},id};
}

/** The label a new route into a node is given: "Find <its title>" into a discovery, its title otherwise. */
export const defaultLabelOf=(node:SceneNode):string=>{const title=node.data.title||node.id;return nodeKind(node)==='discovery'?`Find ${title}`:title};

/**
 * A node's title changed, and the routes into it whose label is still the one they were given from its
 * old title (a new scene's "Find Discovery") following it. A label the author wrote stays as it is.
 */
export function retitleNode(doc:SceneDocument,id:string,title:string):SceneDocument{
  const node=doc.nodes.find(other=>other.id===id);
  const next=setNodeField(doc,id,'title',title);
  if(!node||next===doc)return next;
  const before=defaultLabelOf(node),after=defaultLabelOf(next.nodes.find(other=>other.id===id)!);
  if(before===after||!next.edges.some(route=>route.target===id&&route.label===before))return next;
  return {...next,edges:next.edges.map(route=>route.target===id&&route.label===before?{...route,label:after}:route)};
}

/** A route like another (the same ends), added beside it with an id of its own. */
export function addSiblingRoute(doc:SceneDocument,like:Route):{doc:SceneDocument;id:string}{
  return addRoute(doc,like.source,like.target);
}

/**
 * Nodes taken out, with every route to or from them, and what named them: a route's requires and its
 * onFailure, a cue's outer limit counting from or until one, and who entered at one. The start stays:
 * a scene has exactly one.
 */
export function removeNodes(doc:SceneDocument,ids:Iterable<string>):SceneDocument{
  const gone=new Set([...ids].filter(id=>!doc.nodes.some(node=>node.id===id&&isStart(node))));
  if(!gone.size)return doc;
  const edges=doc.edges.filter(route=>!gone.has(route.source)&&!gone.has(route.target)).map(route=>{
    let data=route.data;
    if(data.requires?.some(id=>gone.has(id)))data=withKey(data,'requires',optionalList(data.requires.filter(id=>!gone.has(id))),ORDER.route);
    if(data.onFailure!==undefined&&gone.has(data.onFailure))data=withKey(data,'onFailure',undefined,ORDER.route);
    data=withLimitChanged(data,id=>gone.has(id)?undefined:id);
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

/** A person taken out of the cast, with the notes the start and the events kept for them. What else names them (a path's via, an effect, an event's fight, who comes to a fight) stays, for the problems to say. */
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
 * refuses a file that settles a fact it hasn't got) and each effect's condition on it (onStart's,
 * onEnd's and the endings'; a condition left with no fact goes).
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
  for(const key of ['onStart','onEnd'] as const){
    const list=doc[key];
    if(!list)continue;
    const changed=list.map(effect=>withFactsChanged(effect as EffectLike,change));
    if(changed.some((effect,i)=>effect!==list[i]))next=setSceneField(next,key,changed);
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

/** Where a fact is tested: an effect's condition (if or unless), in an ending's effects or the scene's onStart or onEnd. */
export type FactTest={at:{kind:'node';id:string}|{kind:'scene';field:'onStart'|'onEnd'};index:number;key:ConditionKey;op:string};
export function testsOf(doc:SceneDocument,fact:string):FactTest[]{
  const tests:FactTest[]=[];
  const look=(at:FactTest['at'],effects:readonly unknown[]|undefined)=>(effects??[]).forEach((effect,index)=>{
    for(const key of ['if','unless'] as const)if(factsIn((effect as EffectLike)[key]).includes(fact))tests.push({at,index,key,op:(effect as EffectLike).op});
  });
  look({kind:'scene',field:'onStart'},doc.onStart);
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

/** A node's id changed, and everything naming it: the routes' ends, what they require and where they fail to, what a cue's outer limit counts from and until, and who arrives there. */
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
    data=withLimitChanged(data,swap);
    return data===next.data?next:{...next,data};
  });
  const cast=doc.cast.map(member=>member.enters===from?withKey(member,'enters',to,ORDER.cast):member);
  return {...doc,nodes,edges,cast};
}

/**
 * A route's data with its outer limit's beats changed by `change`: a beat's new id, or undefined when
 * it's gone (or no longer a beat). A count after one that's gone goes (it counted from something that
 * can't happen now), and one gone from a count's until leaves it (a count left with none runs until it
 * runs out); a limit left with no count goes. The same data comes back when nothing changes.
 */
export function withLimitChanged(data:Route['data'],change:(id:string)=>string|undefined):Route['data']{
  const limit=data.limit;
  if(!limit)return data;
  const counts=limit.flatMap((count):OuterLimit[]=>{
    let next=count;
    if(count.after!==undefined){
      const after=change(count.after);
      if(after===undefined)return [];
      if(after!==count.after)next=withKey(next,'after',after,ORDER.limit);
    }
    if(count.until){
      const until=count.until.flatMap(id=>{const to=change(id);return to===undefined?[]:[to]});
      if(until.length!==count.until.length||until.some((id,i)=>id!==count.until![i]))next=withKey(next,'until',optionalList(until),ORDER.limit);
    }
    return [next];
  });
  if(counts.length===limit.length&&counts.every((count,i)=>count===limit[i]))return data;
  return withKey(data,'limit',optionalList(counts),ORDER.route);
}

/** The routes whose outer limit counts from or until a node. */
export const countingFrom=(doc:SceneDocument,id:string):Route[]=>doc.edges.filter(route=>route.data.limit?.some(count=>count.after===id||count.until?.includes(id)));

/** A route's id changed: nothing else in the file names a route (the co-GM moves the scene by it, and game state keys on it). */
export function renameRoute(doc:SceneDocument,from:string,to:string):SceneDocument{
  if(from===to)return doc;
  return {...doc,edges:doc.edges.map(route=>route.id===from?withKey(route,'id',to,['id']):route)};
}

/**
 * A person's id changed, and everything in the file naming them: the start's and events' notes for
 * them (in their place), the paths via them, the events' fights (either side), the effects naming
 * them (who, a promise's by and to, a fight's allies and leaders, a world op's what and to, in
 * onStart, onEnd, the endings' effects and afterwards), who comes when a fight breaks out, and the
 * talk template's companion. Files outside the scene that name them (the place's people,
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
    const fight=isBeat(node)?node.data.fight:undefined;
    if(fight&&[...fight.foes,...(fight.allies??[])].includes(from)){
      const swap=(ids:string[])=>ids.map(id=>id===from?to:id);
      data=withKey(data,'fight',{foes:swap(fight.foes),...(fight.allies?{allies:swap(fight.allies)}:{})},ORDER.beat);
    }
    if(isEnding(node)&&node.data.effects){
      const effects=node.data.effects.map(effect=>effectRenamingPerson(effect as EffectLike,from,to));
      if(effects.some((effect,i)=>effect!==node.data.effects![i]))data=withKey(data,'effects',effects,ORDER.exit);
    }
    return data===node.data?node:{...node,data};
  });
  let next:SceneDocument={...doc,cast,nodes};
  for(const key of ['onStart','onEnd','afterwards'] as const){
    const list=doc[key] as EffectLike[]|undefined;
    if(!list)continue;
    const changed=list.map(effect=>effectRenamingPerson(effect,from,to));
    if(changed.some((effect,i)=>effect!==list[i]))next=setSceneField(next,key,changed);
  }
  if(doc.companion===from)next=setSceneField(next,'companion',to);
  if(doc.reinforcements?.some(item=>item.id===from))next=setReinforcements(next,doc.reinforcements.map(item=>item.id===from?{...item,id:to}:item));
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

/** A beat made a discovery: an empty revelation and no paths yet; an event's pressure, conversation roles and fight go, and whoever arrived there is here from the start. */
export function makeDiscovery(doc:SceneDocument,id:string):SceneDocument{
  const node=doc.nodes.find(other=>other.id===id);
  if(!node||!isBeat(node)||isDiscovery(node))return doc;
  const next=updateNode(doc,id,data=>{
    let beat:NodeData=withKey(withKey(data,'revelation','',ORDER.beat),'paths',(data as BeatData).paths??[],ORDER.beat);
    for(const key of ['pressure','cast','fight'])beat=withKey(beat,key,undefined,ORDER.beat);
    return beat;
  });
  return {...next,cast:next.cast.map(member=>member.enters===id?withKey(member,'enters',undefined,ORDER.cast):member)};
}

/** What only a beat has, and what only an ending has: each goes when the node becomes the other. */
const BEAT_ONLY=['revelation','paths','required','cast','pressure','fight','establishes','carry'];
const ENDING_ONLY=['closing','result','exitKind','next','effects'];

/**
 * A beat made an ending: what only a beat has goes (its revelation, paths and required mark, its
 * conversation roles and pressure, the facts it settles, what the story carries), and it's a good
 * progress ending with no closing yet, as a new one is. No route leaves an ending, so its routes out
 * go; a route that required it requires it no more (only a beat is required), a cue's outer limit
 * counts from and until it no more (only a beat is counted from), and whoever arrived there is here
 * from the start. Its title, description, lore and its routes in stay.
 */
export function makeEnding(doc:SceneDocument,id:string):SceneDocument{
  const node=doc.nodes.find(other=>other.id===id);
  if(!node||!isBeat(node))return doc;
  const next=updateNode(doc,id,data=>{
    let ending=withKey(data,'kind','exit',ORDER.exit) as NodeData;
    for(const key of BEAT_ONLY)ending=withKey(ending,key,undefined,ORDER.exit);
    for(const [key,value] of [['closing',''],['result','good'],['exitKind','progress']] as const)ending=withKey(ending,key,value,ORDER.exit);
    return ending;
  });
  const edges=next.edges.filter(route=>route.source!==id).map(route=>{
    let data=route.data;
    if(data.requires?.includes(id))data=withKey(data,'requires',optionalList(data.requires.filter(other=>other!==id)),ORDER.route);
    data=withLimitChanged(data,other=>other===id?undefined:other);
    return data===route.data?route:{...route,data};
  });
  return {...next,edges,cast:next.cast.map(member=>member.enters===id?withKey(member,'enters',undefined,ORDER.cast):member)};
}

/** An ending made a beat, a discovery (an empty revelation and no paths yet) or an event: what only an ending has goes (its closing, result, exit kind, next scene and effects). The rest stays. */
export function makeBeat(doc:SceneDocument,id:string,kind:'discovery'|'event'):SceneDocument{
  const node=doc.nodes.find(other=>other.id===id);
  if(!node||!isEnding(node))return doc;
  return updateNode(doc,id,data=>{
    let beat=withKey(data,'kind','beat',ORDER.beat) as NodeData;
    for(const key of ENDING_ONLY)beat=withKey(beat,key,undefined,ORDER.beat);
    if(kind==='discovery')beat=withKey(withKey(beat,'revelation','',ORDER.beat),'paths',[],ORDER.beat);
    return beat;
  });
}

/** A node made another kind, a discovery, an event or an ending, losing what the new kind has no use for (the start stays the start: a scene has exactly one). */
export function changeKind(doc:SceneDocument,id:string,kind:NewNodeKind):SceneDocument{
  const node=doc.nodes.find(other=>other.id===id);
  if(!node||isStart(node)||nodeKind(node)===kind)return doc;
  if(kind==='ending')return makeEnding(doc,id);
  if(isEnding(node))return makeBeat(doc,id,kind);
  return kind==='event'?makeEvent(doc,id):makeDiscovery(doc,id);
}

/**
 * What a node would lose by becoming another kind, in words, for the author to be asked first ([] when
 * nothing they wrote goes): its fields the new kind has no use for, and what else in the scene goes
 * with it (an ending's routes out, what required it, who arrived there).
 */
export function kindLosses(doc:SceneDocument,id:string,kind:NewNodeKind):string[]{
  const node=doc.nodes.find(other=>other.id===id);
  if(!node||isStart(node)||nodeKind(node)===kind)return [];
  const count=(n:number,one:string,many=`${one}s`)=>`${n} ${n===1?one:many}`;
  if(isEnding(node)){
    const d=node.data;
    return [d.closing.trim()?'its closing':'',d.effects?.length?`its ${count(d.effects.length,'effect')}`:'',d.next?'its next scene':''].filter(Boolean);
  }
  const d=(node as SceneNode<BeatData>).data;
  const revelation=[d.revelation?.trim()?'its revelation':'',d.paths?.length?`its ${count(d.paths.length,'path')}`:'',d.required?'its required mark':''];
  const stage=[d.pressure!==undefined?'its pressure':'',d.fight?'its fight':'',Object.keys(d.cast??{}).length?`its ${count(Object.keys(d.cast??{}).length,'conversation role')}`:''];
  const arriving=doc.cast.filter(member=>member.enters===id).length;
  const arrivals=arriving?`its ${count(arriving,'arrival')} (they're here from the start instead)`:'';
  if(kind==='event')return revelation.filter(Boolean);
  if(kind==='discovery')return [...stage,arrivals].filter(Boolean);
  const out=doc.edges.filter(route=>route.source===id).length,requiring=doc.edges.filter(route=>route.data.requires?.includes(id)).length;
  const counting=countingFrom(doc,id).filter(route=>route.source!==id).length;
  return [...revelation,...stage,arrivals,
    d.establishes?.length?`the ${count(d.establishes.length,'fact')} it settles`:'',d.carry?'what the story carries of it':'',
    out?`its ${count(out,'route')} out (no route leaves an ending)`:'',requiring?`what ${count(requiring,'route')} require${requiring===1?'s':''} of it`:'',
    counting?`how ${count(counting,'cue')} count${counting===1?'s':''} from or until it`:''].filter(Boolean);
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
 * the format's rules, the talk's own when it's the campaign's talk template, and where the story goes
 * from it.
 */
export function problemsOf(key:string,doc:SceneDocument,context:SceneContext):Problem[]{
  const shape=shapeOf(doc);
  if(shape.length)return shape.map(message=>({message,at:{kind:'scene'}}));
  const ids=new Set([...context.scenes,...(context.talk?[context.talk]:[]),...context.others.map(other=>other.id),doc.id]);
  return [...sceneRuleProblems(key,doc,context),...(key===context.talk?talkTemplateProblems(doc):[]),...sceneStoryProblems(doc,ids)];
}

// ---------------------------------------------------------------------------------------------
// Warnings: what the game takes as it is but the author should look at, which the campaign check doesn't refuse.

/** A path's via, as words to match: no case, no leading article, nothing in brackets, one space between words. */
const words=(text:string)=>text.toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[’]/g,"'").replace(/\s+/g,' ').trim().replace(/^(the|a|an) /,'');

/**
 * Whether a via names someone or something the scene has: one of the cast (by id, name, what they're
 * called or also known as), or a thing or a part of the scene's place (by id or name). Words, not
 * case or a leading article: "the tally loft" names the loft, "The Tally Loft (above the yard)".
 */
export function viaNames(via:string,doc:SceneDocument,place:PlaceFile|undefined):boolean{
  const v=words(via);
  if(!v)return true;
  const names=[
    ...doc.cast.flatMap(member=>[member.id,member.name,member.called??'',...(member.aka??[])]),
    ...(place?[...place.things.flatMap(thing=>[thing.id,thing.name]),...place.areas.flatMap(area=>[area.id,area.name])]:[]),
  ];
  return names.some(name=>name&&words(name)===v);
}

/**
 * The warnings for a scene: each discovery's path whose via, of more than one word, names neither one
 * of the cast nor a thing (or part) of its place. The game reads a via as words, so it isn't refused;
 * but the GM is told the clue is with something the scene doesn't have. (A via of one word is a cast
 * id, which the rules hold it to.) A scene with no place of the campaign's has nothing to check.
 */
export function viaWarnings(doc:SceneDocument,place:PlaceFile|undefined):Problem[]{
  if(!place)return [];
  return doc.nodes.filter(isBeat).flatMap(node=>(node.data.paths??[]).flatMap((path,i)=>{
    const via=path.via.trim();
    if(!via.includes(' ')||viaNames(via,doc,place))return [];
    return [{message:`discovery ${node.id}'s path ${i+1} is via “${via}”, which is neither one of the cast nor a thing of ${place.key}`,at:{kind:'node' as const,id:node.id}}];
  }));
}
