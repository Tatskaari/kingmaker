// The inspectors for what's selected on the graph: a node (the start, a discovery, an event, an ending)
// and a connection (the routes between two nodes, one way).
import React,{useId,useMemo} from 'react';
import {ArrowRight,Dices,Link,Plus,Trash2} from 'lucide-react';
import {useScene} from './api.ts';
import {Checkbox,Checklist,LoreLinks,NumberField,SelectField,TextArea,TextField} from './fields.tsx';
import type {Option} from './fields.tsx';
import {EffectsEditor} from './effects.tsx';
import type {EffectChoices,EffectData} from './effects.tsx';
import {EXIT_KINDS,ORDER,RESULTS,SKILLS,STRENGTHS,addRoute,isBeat,isDiscovery,isEnding,isStart,moveRoutes,nodeKind,optionalList,optionalText,removeNodes,removeRoutes,setArrival,setNodeField,setRouteField,titleOf,updateNode,updateRoute,withKey} from './model.ts';
import type {BeatData,Connection,EndingData,NodeKind,Path,Route,SceneDocument,SceneNode,StartData} from './model.ts';

export const KIND_LABELS:Record<NodeKind,string>={start:'Start',discovery:'Discovery',event:'Event',ending:'Ending'};
const RESULT_LABELS:Record<string,string>={good:'Good',mixed:'Mixed',bad:'Bad'};
const EXIT_LABELS:Record<string,string>={combat:'Combat (a fight)',persuaded:'Persuaded',progress:'Progress',leave:'Leave',other:'Other'};
const SKILL_LABEL=(skill:string)=>skill.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());
export const SKILL_OPTIONS:Option[]=SKILLS.map(skill=>({value:skill,label:SKILL_LABEL(skill)}));

// ---------------------------------------------------------------------------------------------
// Choices the fields offer, from the scene and its campaign.

/** The scene's facts, to settle or test: each id with its sentence. */
export function factOptions(doc:SceneDocument):Option[]{
  return Object.entries(doc.facts??{}).map(([id,sentence])=>({value:id,label:id,detail:sentence}));
}

/** The cast, by id, named. */
export const castOptions=(doc:SceneDocument):Option[]=>doc.cast.map(member=>({value:member.id,label:`${member.name||member.id} (${member.id})`}));

/** What an effect chooses from. */
export function effectChoices(doc:SceneDocument,quests:Record<string,string>):EffectChoices{
  return {cast:castOptions(doc),facts:factOptions(doc),quests:Object.entries(quests).map(([id,title])=>({value:id,label:`${title} (${id})`}))};
}

// ---------------------------------------------------------------------------------------------
// A node.

/** The inspector for a node: what every node has, then its kind's fields, its lore, and the routes in and out. */
export function NodeInspector({node}:{node:SceneNode}){
  const {edit,confirm,doc,connectFrom}=useScene();
  const kind=nodeKind(node);
  const set=(key:string,value:unknown)=>edit(scene=>setNodeField(scene,node.id,key,value));
  const remove=()=>{
    const routes=doc.edges.filter(route=>route.source===node.id||route.target===node.id).length;
    confirm({title:'Delete node?',confirmLabel:'Delete node',description:`Delete “${node.data.title||node.id}”${routes?` and the ${routes} route${routes===1?'':'s'} to and from it`:''}? Routes that require it, or fail into it, forget it, and anyone who arrives there arrives from the start. You can undo this.`,onConfirm:()=>edit(scene=>removeNodes(scene,[node.id]))});
  };
  return <div className={`node-inspector ${kind}`} data-node={node.id}>
    <p className="inspector-kind"><span className={`kind-dot ${kind}`}/>{KIND_LABELS[kind]}<code title="The node's id: game state keys on it, so it stays as it is when the title changes">{node.id}</code></p>
    <TextField label="Title" field="title" value={node.data.title} onChange={value=>set('title',value)}/>
    {kind==='start'&&<StartFields node={node as SceneNode<StartData>}/>}
    {kind==='discovery'&&<DiscoveryFields node={node as SceneNode<BeatData>}/>}
    {kind==='event'&&<EventFields node={node as SceneNode<BeatData>}/>}
    {kind==='ending'&&<EndingFields node={node as SceneNode<EndingData>}/>}
    <NodeLore node={node}/>
    <RoutesOf node={node}/>
    <div className="inspector-actions">
      {kind!=='ending'&&<button type="button" onClick={()=>connectFrom(node.id)}><Link size={14}/>Add route to…</button>}
      {kind!=='start'&&<button type="button" className="danger" title="Delete node" onClick={remove}><Trash2 size={14}/>Delete node</button>}
    </div>
  </div>;
}

function StartFields({node}:{node:SceneNode<StartData>}){
  const {edit,doc}=useScene();
  const here=doc.cast.filter(member=>member.enters===undefined);
  return <>
    <TextArea label="Opening" field="description" rows={7} hint="The situation the player walks into, the suggested ways into it, how to play the people here, and an opening image." value={node.data.description} onChange={value=>edit(scene=>setNodeField(scene,node.id,'description',value))}/>
    <CastNotes node={node} people={here} label="Conversation roles at the start" hint="Each person's role as the scene opens: the co-GM's first note. Behaviour, not meaning."/>
  </>;
}

function DiscoveryFields({node}:{node:SceneNode<BeatData>}){
  const {edit}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setNodeField(scene,node.id,key,value));
  const paths=node.data.paths??[];
  return <>
    <TextArea label="Revelation" field="revelation" hint="What the player comes to understand, in a sentence or two." value={node.data.revelation??''} onChange={value=>set('revelation',value)}/>
    <TextArea label="How to play it" field="description" rows={4} hint="What the discovery is for and how to play it." value={node.data.description} onChange={value=>set('description',value)}/>
    <Checkbox label="Required" field="required" hint="The scene can't end well without it: give it three paths or more, one needing no dice." checked={!!node.data.required} onChange={checked=>set('required',checked?true:undefined)}/>
    <PathsEditor node={node} paths={paths}/>
    <Establishes node={node}/>
    <CarryEditor node={node}/>
  </>;
}

function EventFields({node}:{node:SceneNode<BeatData>}){
  const {edit,doc}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setNodeField(scene,node.id,key,value));
  const arriving=doc.cast.filter(member=>member.enters===node.id).map(member=>member.id);
  const arrive=(ids:string[])=>edit(scene=>scene.cast.reduce((next,member)=>{
    const now=ids.includes(member.id),was=member.enters===node.id;
    return now===was?next:setArrival(next,member.id,node.id,now);
  },scene));
  return <>
    <TextArea label="What happens" field="description" rows={5} hint="What happens, and what it puts to the player." value={node.data.description} onChange={value=>set('description',value)}/>
    <TextArea label="Pressure" field="pressure" hint="What the world does if the scene stalls here." value={node.data.pressure??''} onChange={value=>set('pressure',optionalText(value))}/>
    <Checklist label="Who arrives here" field="arrivals" options={doc.cast.map(member=>({value:member.id,label:`${member.name||member.id} (${member.id})`,...(member.enters&&member.enters!==node.id?{detail:`Arrives at ${titleOf(doc,member.enters)} now`}:{})}))} selected={arriving} onChange={arrive} hint="Present from the start unless they arrive at an event." empty="The scene has no cast yet."/>
    <CastNotes node={node} people={doc.cast} label="Conversation roles here" hint="Each person's role while the scene is here: the co-GM's suggestions."/>
    <Establishes node={node}/>
  </>;
}

function EndingFields({node}:{node:SceneNode<EndingData>}){
  const {edit,doc,campaign,openScene}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setNodeField(scene,node.id,key,value));
  const scenes:Option[]=[{value:'',label:'Nowhere: the story ends here'},...(campaign?.scenes??[]).filter(scene=>scene.id!==campaign?.talk).map(scene=>({value:scene.id,label:`${scene.title} (${scene.id})`}))];
  const choices=effectChoices(doc,campaign?.quests??{});
  return <>
    <TextArea label="What's true" field="description" rows={4} hint="What is true if the scene ends this way." value={node.data.description} onChange={value=>set('description',value)}/>
    <TextArea label="Closing" field="closing" rows={4} hint="How the GM should close it: the feeling, the last image." value={node.data.closing} onChange={value=>set('closing',value)}/>
    <div className="field-row">
      <SelectField label="Result" field="result" value={node.data.result} options={RESULTS.map(result=>({value:result,label:RESULT_LABELS[result]}))} onChange={value=>set('result',value)}/>
      <SelectField label="Exit kind" field="exitKind" value={node.data.exitKind} options={EXIT_KINDS.map(kind=>({value:kind,label:EXIT_LABELS[kind]}))} onChange={value=>set('exitKind',value)}/>
    </div>
    <SelectField label="Next scene" field="next" hint="The scene the story goes on to: one of the campaign's." value={node.data.next??''} options={scenes} onChange={value=>set('next',optionalText(value))}/>
    {node.data.next&&<button type="button" className="text-button" onClick={()=>openScene(node.data.next!)}>Open {node.data.next} <ArrowRight size={12}/></button>}
    <EffectsEditor label="Effects" field="effects" hint="What ending this way does to the story and the world." effects={(node.data.effects??[]) as EffectData[]} choices={choices} onChange={effects=>set('effects',optionalList(effects))}/>
    <WaysIn node={node}/>
  </>;
}

/** What an ending needs is in its routes' requires: each way in, and the beats it requires. */
function WaysIn({node}:{node:SceneNode}){
  const {doc,showRoute}=useScene();
  const routes=doc.edges.filter(route=>route.target===node.id);
  return <div className="ways-in">
    <span className="field-label">Ways in</span>
    {!routes.length&&<p className="muted">No route comes here yet.</p>}
    {routes.map(route=><button type="button" key={route.id} className="way-in" onClick={()=>showRoute(route.id)}>
      <b>{route.label||route.id}</b>
      <small>from {titleOf(doc,route.source)}{route.data.requires?.length?` · requires ${route.data.requires.map(id=>titleOf(doc,id)).join(', ')}`:' · requires nothing'}</small>
    </button>)}
  </div>;
}

/** Each person's note at the start or an event: a role for the co-GM, empty for none. */
function CastNotes({node,people,label,hint}:{node:SceneNode<StartData|BeatData>;people:SceneDocument['cast'];label:string;hint:string}){
  const {edit,doc}=useScene();
  const notes=node.data.cast??{};
  const shown=[...people.map(member=>member.id),...Object.keys(notes).filter(id=>!people.some(member=>member.id===id))];
  const set=(id:string,value:string)=>edit(scene=>updateNode(scene,node.id,data=>{
    const current=('cast' in data?data.cast:undefined)??{};
    const next=value.trim()?{...current,[id]:value}:Object.fromEntries(Object.entries(current).filter(([who])=>who!==id));
    return withKey(data,'cast',Object.keys(next).length?next:undefined,ORDER[data.kind]);
  }));
  return <fieldset className="cast-notes" data-field="cast">
    <legend className="field-label">{label}</legend>
    {!shown.length&&<p className="muted">Nobody is here yet: add people in the Cast panel.</p>}
    {shown.map(id=>{const member=doc.cast.find(person=>person.id===id);return <TextArea key={id} label={member?`${member.name||id} (${id})`:`${id} (not in the cast)`} rows={2} value={notes[id]??''} onChange={value=>set(id,value)}/>})}
    <small className="field-hint">{hint}</small>
  </fieldset>;
}

/** A discovery's paths: who or what holds it, the clue, what earns it, how strong it is, and a roll that suits it. */
function PathsEditor({node,paths}:{node:SceneNode<BeatData>;paths:Path[]}){
  const {edit,doc,place}=useScene();
  const listId=useId();
  const setPaths=(next:Path[])=>edit(scene=>setNodeField(scene,node.id,'paths',next));
  const setPath=(index:number,key:string,value:unknown)=>edit(scene=>updateNode(scene,node.id,data=>{
    const list=((data as BeatData).paths??[]).map((path,i)=>i===index?withKey(path,key,value,ORDER.path):path);
    return withKey(data,'paths',list,ORDER.beat);
  }));
  const vias=useMemo(()=>[
    ...doc.cast.map(member=>({value:member.id,label:member.name})),
    ...(place?.things??[]).map(thing=>({value:thing.name,label:`a thing of ${place!.name}`})),
    ...(place?.areas??[]).map(area=>({value:area.name,label:`a part of ${place!.name}`})),
  ],[doc.cast,place]);
  const required=!!node.data.required;
  return <fieldset className="paths" data-field="paths">
    <legend className="field-label">Paths <span className="count">{paths.length}</span></legend>
    <small className="field-hint">Ways it can come out: examples, not a sequence. {required?'Required: three or more, one with no roll.':'Two or more.'}</small>
    <datalist id={listId}>{vias.map(via=><option key={`${via.value}:${via.label}`} value={via.value}>{via.label}</option>)}</datalist>
    {paths.map((path,index)=><article className="path" key={index} aria-label={`Path ${index+1}`}>
      <header><span className="path-number">{index+1}</span><b>{path.via||'Via…'}</b><span className={`strength ${path.strength}`}>{path.strength}</span>{path.check&&<span className="dice-badge"><Dices size={11}/>{SKILL_LABEL(path.check.skill)} {path.check.dc}</span>}
        <button type="button" title="Remove path" aria-label={`Remove path ${index+1}`} onClick={()=>setPaths(paths.filter((_,i)=>i!==index))}><Trash2 size={13}/></button>
      </header>
      <TextField label="Via" list={listId} hint="A cast id, or a thing or place in a few words (“the body”)." value={path.via} onChange={value=>setPath(index,'via',value)}/>
      <TextArea label="Clue" rows={2} hint="What's there to find or hear, concretely." value={path.clue} onChange={value=>setPath(index,'clue',value)}/>
      <TextArea label="Earn" rows={2} hint="What earns it: free to a look, a kindness, a promise, a roll. Say when it's free." value={path.earn} onChange={value=>setPath(index,'earn',value)}/>
      <SelectField label="Strength" value={path.strength} options={STRENGTHS.map(strength=>({value:strength,label:strength}))} onChange={value=>setPath(index,'strength',value)}/>
      <Checkbox label="A roll suits it" hint="The mouthpiece calls this check when the player tries this path and the outcome is uncertain." checked={!!path.check} onChange={checked=>setPath(index,'check',checked?{skill:'investigation',dc:12}:undefined)}/>
      {path.check&&<div className="field-row">
        <SelectField label="Check skill" value={path.check.skill} options={SKILL_OPTIONS} onChange={value=>setPath(index,'check',withKey(path.check!,'skill',value,ORDER.check))}/>
        <NumberField label="Check DC" min={1} max={30} value={path.check.dc} onChange={value=>setPath(index,'check',withKey(path.check!,'dc',value,ORDER.check))}/>
      </div>}
    </article>)}
    <button type="button" className="add-item" onClick={()=>setPaths([...paths,{via:'',clue:'',earn:'',strength:'suggestive'}])}><Plus size={13}/>Add path</button>
  </fieldset>;
}

/** The facts a beat settles when it's reached. */
function Establishes({node}:{node:SceneNode<BeatData>}){
  const {edit,doc}=useScene();
  return <Checklist label="Establishes" field="establishes" hint="Facts settled when it's reached: the GM is told their sentences, and endings' effects test them. Add facts in the Scene panel." options={factOptions(doc)} selected={node.data.establishes??[]} empty="The scene has no facts yet." onChange={facts=>edit(scene=>setNodeField(scene,node.id,'establishes',optionalList(facts)))}/>;
}

/** When the rest of the story needs a discovery too: what it opens up, what later needs it, the things it's in. */
function CarryEditor({node}:{node:SceneNode<BeatData>}){
  const {edit,place,campaign,doc}=useScene();
  const carry=node.data.carry;
  const set=(value:BeatData['carry'])=>edit(scene=>setNodeField(scene,node.id,'carry',value));
  const things:Option[]=[
    ...(place?.things??[]).map(thing=>({value:thing.id,label:`${thing.name} (${thing.id})`})),
    ...carriedElsewhere(campaign?.scenes.map(scene=>scene.doc).filter((other):other is SceneDocument=>!!other&&other.id!==doc.id)??[]).filter(id=>!place?.things.some(thing=>thing.id===id)).map(id=>({value:id,label:`${id} (carried from another scene)`})),
  ];
  return <div className="carry" data-field="carry">
    <Checkbox label="The story carries it" hint="Missed, the story owes it to the player in the next scene that can hold it." checked={!!carry} onChange={checked=>set(checked?{unlocks:''}:undefined)}/>
    {carry&&<>
      <TextArea label="Unlocks" rows={2} hint="What it opens up." value={carry.unlocks} onChange={value=>set(withKey(carry,'unlocks',value,ORDER.carry))}/>
      <TextArea label="Later" rows={2} hint="What later needs it." value={carry.later??''} onChange={value=>set(withKey(carry,'later',optionalText(value),ORDER.carry))}/>
      <Checklist label="Things" hint="The things of the place it's in (Prout's page in Cob's boot)." options={things} selected={carry.things??[]} empty="The scene's place has no things." onChange={list=>set(withKey(carry,'things',optionalList(list),ORDER.carry))}/>
    </>}
  </div>;
}

function carriedElsewhere(scenes:SceneDocument[]):string[]{
  return [...new Set(scenes.flatMap(scene=>scene.nodes.filter(isBeat).flatMap(node=>node.data.carry?.things??[])))];
}

/** A node's lore links: paths under the campaign's lore/. */
function NodeLore({node}:{node:SceneNode}){
  const {edit,loreNames,openLore,pickLore}=useScene();
  const set=(paths:string[])=>edit(scene=>setNodeField(scene,node.id,'lore',paths));
  return <LoreLinks label="Lore" field="lore" paths={node.data.lore} names={loreNames} onOpen={openLore} onUnlink={path=>set(node.data.lore.filter(other=>other!==path))} onAdd={()=>pickLore({title:`Lore for ${node.data.title||node.id}`,linked:node.data.lore,onPick:path=>edit(scene=>{const current=scene.nodes.find(other=>other.id===node.id)?.data.lore??[];return current.includes(path)?scene:setNodeField(scene,node.id,'lore',[...current,path])})})}/>;
}

/** The routes into and out of a node, each opening its connection. */
function RoutesOf({node}:{node:SceneNode}){
  const {doc,showRoute}=useScene();
  const routes=doc.edges.filter(route=>route.source===node.id||route.target===node.id);
  return <details className="route-list" open>
    <summary>Routes <span className="count">{routes.length}</span></summary>
    {routes.map(route=><button type="button" key={route.id} onClick={()=>showRoute(route.id)}><b>{titleOf(doc,route.source)} → {titleOf(doc,route.target)}</b><small>{route.label||route.id}</small></button>)}
  </details>;
}

// ---------------------------------------------------------------------------------------------
// A connection: the routes from one node to another.

/** The inspector for a connection: every route between the two nodes in that direction, each its own. */
export function ConnectionInspector({connection}:{connection:Connection}){
  const {doc,edit,confirm,editingRoute,setEditingRoute,showRoute}=useScene();
  const from=titleOf(doc,connection.source),to=titleOf(doc,connection.target);
  const move=(side:'source'|'target',node:string)=>{
    const ids=connection.routes.map(route=>route.id);
    edit(scene=>moveRoutes(scene,ids,side,node));
    showRoute(ids[0]);
  };
  const ends=(side:'source'|'target'):Option[]=>doc.nodes.filter(node=>side==='source'?!isEnding(node):!isStart(node)).map(node=>({value:node.id,label:`${node.data.title||node.id} (${node.id})`}));
  const add=()=>{let id='';edit(scene=>{const added=addRoute(scene,connection.source,connection.target);id=added.id;return added.doc});setEditingRoute(id)};
  const removeAll=()=>confirm({title:'Delete routes?',confirmLabel:'Delete routes',description:`Delete all ${connection.routes.length} route${connection.routes.length===1?'':'s'} from “${from}” to “${to}”? Both nodes stay. You can undo this.`,onConfirm:()=>edit(scene=>removeRoutes(scene,connection.routes.map(route=>route.id)))});
  return <div className="connection-inspector">
    <p className="route-path"><b>{from}</b> → <b>{to}</b></p>
    <p className="muted">{connection.routes.length} route{connection.routes.length===1?'':'s'}: each its own way for the scene to move from one to the other.</p>
    <details className="connection-endpoints">
      <summary>Move these routes</summary>
      <p className="muted">Every route here moves together, its id and the rest of it as they were.</p>
      <SelectField label="From" value={connection.source} options={ends('source')} onChange={value=>move('source',value)}/>
      <SelectField label="To" value={connection.target} options={ends('target')} onChange={value=>move('target',value)}/>
    </details>
    {connection.routes.map((route,index)=><RouteCard key={route.id} route={route} index={index} open={editingRoute===route.id||connection.routes.length===1} onToggle={connection.routes.length===1?undefined:open=>setEditingRoute(open?route.id:null)}/>)}
    <div className="inspector-actions">
      <button type="button" onClick={add}><Plus size={14}/>Add route</button>
      <button type="button" className="danger" onClick={removeAll}><Trash2 size={14}/>Delete routes</button>
    </div>
  </div>;
}

/** One route: its summary, or every field of it. */
function RouteCard({route,index,open,onToggle}:{route:Route;index:number;open:boolean;onToggle?:(open:boolean)=>void}){
  const {doc,edit,confirm}=useScene();
  const d=route.data;
  const remove=()=>confirm({title:'Remove route?',confirmLabel:'Remove route',description:`Remove “${route.label||route.id}”? You can undo this.`,onConfirm:()=>edit(scene=>removeRoutes(scene,[route.id]))});
  return <article className={`route-card ${open?'open':''}`} data-route-id={route.id} aria-label={`Route ${route.label||route.id}`}>
    <header>
      <span className="way-number">{index+1}</span>
      <h3>{route.label||'Untitled route'}</h3>
      {onToggle&&<button type="button" aria-expanded={open} onClick={()=>onToggle(!open)}>{open?'Done':'Edit route'}</button>}
    </header>
    <div className="way-badges">
      <code>{route.id}</code>
      <span>{d.phase==='cue'?'Cue':'Outcome'}</span>
      {d.skill&&<span className="dice-badge"><Dices size={11}/>{SKILL_LABEL(d.skill)} DC {d.dc}</span>}
      {d.requires?.length?<span>Requires {d.requires.map(id=>titleOf(doc,id)).join(', ')}</span>:null}
      {d.onFailure&&<span>Fails to {titleOf(doc,d.onFailure)}</span>}
    </div>
    {open?<RouteFields route={route} onRemove={remove}/>:<p className="way-condition">{d.condition||'No condition: taken when the revelation has landed.'}</p>}
  </article>;
}

function RouteFields({route,onRemove}:{route:Route;onRemove:()=>void}){
  const {doc,edit}=useScene();
  const d=route.data;
  const set=(key:string,value:unknown)=>edit(scene=>setRouteField(scene,route.id,key,value));
  const target=doc.nodes.find(node=>node.id===route.target);
  const beats:Option[]=doc.nodes.filter(isBeat).filter(node=>node.id!==route.target).map(node=>({value:node.id,label:`${node.data.title||node.id} (${node.id})`,detail:isDiscovery(node)?'Discovery':'Event'}));
  const nodes:Option[]=doc.nodes.filter(node=>node.id!==route.source).map(node=>({value:node.id,label:`${node.data.title||node.id} (${node.id})`}));
  const setSkill=(skill:string)=>edit(scene=>{
    let next=setRouteField(scene,route.id,'skill',skill);
    if(!skill)next=setRouteField(next,route.id,'onFailure',undefined);
    return next;
  });
  return <div className="way-fields">
    <TextField label="Label" field="label" hint="The route's name on the graph." value={route.label} onChange={value=>edit(scene=>updateRoute(scene,route.id,old=>({...old,label:value})))}/>
    <TextArea label="Condition" field="condition" hint={target&&isDiscovery(target)?'What has to have happened, in prose. Into a discovery it may be empty: the route is taken when the revelation has landed.':'What has to have happened in the story to take it, in prose.'} value={d.condition} onChange={value=>set('condition',value)}/>
    <SelectField label="Phase" field="phase" hint="Outcome: judged on what has happened. Cue: a moment the co-GM brings about when it comes." value={d.phase} options={[{value:'outcome',label:'Outcome'},{value:'cue',label:'Cue'}]} onChange={value=>set('phase',value)}/>
    <Checklist label="Requires" field="requires" hint="Beats that must have been reached first: an ending's evidence, the lead." options={beats} selected={d.requires??[]} empty="The scene has no beats to require." onChange={ids=>set('requires',optionalList(ids))}/>
    <div className="field-row">
      <SelectField label="Dice" field="skill" value={d.skill} options={[{value:'',label:'No dice'},...SKILL_OPTIONS]} onChange={setSkill}/>
      <NumberField label="DC" field="dc" min={1} max={30} disabled={!d.skill} value={d.dc} onChange={value=>set('dc',value)}/>
    </div>
    {d.skill&&<SelectField label="On failure" field="onFailure" hint="Where a failed check goes; or the scene stays where it is, and the route stays open." value={d.onFailure??''} options={[{value:'',label:'Stays where it is'},...nodes]} onChange={value=>set('onFailure',optionalText(value))}/>}
    <Checklist label="Establishes" field="establishes" hint="Facts settled when it's taken (a dice route's on a success)." options={factOptions(doc)} selected={d.establishes??[]} empty="The scene has no facts yet." onChange={facts=>set('establishes',optionalList(facts))}/>
    <button type="button" className="text-button danger" onClick={onRemove}><Trash2 size={13}/>Remove route</button>
  </div>;
}

