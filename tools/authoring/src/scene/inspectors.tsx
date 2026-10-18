// The inspector of what's selected on the graph: a node (the start, a discovery, an event, an ending) or
// a connection (the routes between two nodes, one way). Each shows every field its part of the file can
// hold: the optional ones as [+ Add …] until they're there, the lists as cards or chips with [+ Add …],
// and its id, renamed only by asking.
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {ArrowRight,Dices,Link,Plus,Trash2} from 'lucide-react';
import {useScene} from './api.ts';
import {AddPicker,Checkbox,Chips,ChoiceField,IdField,ItemCard,LoreLinks,NumberField,OptionalSection,SelectField,TextArea,TextField,moved} from './fields.tsx';
import type {Option} from './fields.tsx';
import {EffectsEditor} from './effects.tsx';
import {FactsField} from './facts.tsx';
import {EXIT_KINDS,ORDER,SKILLS,addRoute,idProblem,isBeat,isDiscovery,isEnding,isStart,makeDiscovery,makeEvent,moveRoutes,nodeKind,optionalList,removeNodes,removeRoutes,renameNode,renameRoute,setArrival,setNodeField,setRouteField,titleOf,updateNode,updateRoute,withKey} from './model.ts';
import type {BeatData,Connection,EndingData,NodeKind,Path,Route,SceneDocument,SceneNode,StartData} from './model.ts';

export const KIND_LABELS:Record<NodeKind,string>={start:'Start',discovery:'Discovery',event:'Event',ending:'Ending'};
const SKILL_LABEL=(skill:string)=>skill.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());
export const SKILL_OPTIONS:Option[]=SKILLS.map(skill=>({value:skill,label:SKILL_LABEL(skill)}));

/** An ending's result: what it means for the story, and for QA. */
export const RESULT_OPTIONS=[
  {value:'good',label:'Good',tone:'good',detail:'The player got what the scene was for. The story goes on at its best. QA counts it as ending well; in a scene with a required discovery, every way into it must require something found.'},
  {value:'mixed',label:'Mixed',tone:'mixed',detail:'They got some of it (the lead, not the proof). The story goes on, a little worse off. QA counts it as ending well too.'},
  {value:'bad',label:'Bad',tone:'bad',detail:'A last resort (a crime, the case abandoned): the scene ends without what it was for. QA doesn\'t count it; every scene needs a good or mixed ending it can reach.'},
];
/** An ending's exit kind, in full: only combat changes what the game does. */
const EXIT_OPTIONS:Record<string,{label:string;detail:string}>={
  combat:{label:'Combat: it ends in a fight',detail:'The GM closes on the moment the fight breaks out, before a blow lands, and the fight is played out on the map before the story picks up again.'},
  persuaded:{label:'Persuaded: someone is talked round',detail:'It ends because someone was won over. The story reads it as a label; the effects say what it changes.'},
  progress:{label:'Progress: the story moves on',detail:'The case made or the errand done. The story reads it as a label; the effects say what it changes.'},
  leave:{label:'Leave: the player walks away, or is sent away',detail:'The story reads it as a label; the effects say what it changes.'},
  other:{label:'Other: none of these',detail:'The story reads it as a label; the effects say what it changes.'},
};
const STRENGTH_OPTIONS=[
  {value:'hook',label:'Hook',detail:'A hook: it points the way, and no more.'},
  {value:'suggestive',label:'Suggestive',detail:'Suggestive: it hints, and needs backing up (a frightened child\'s account).'},
  {value:'strong',label:'Strong',detail:'Strong: hard to dismiss (a sergeant who saw it).'},
  {value:'proof',label:'Proof',detail:'Proof: it settles it (a document, a confession).'},
];
const PHASE_OPTIONS=[
  {value:'outcome',label:'Outcome',detail:'Outcome: judged on what has happened in the story.'},
  {value:'cue',label:'Cue',detail:'Cue: a moment (the noon bell, the player setting off) that the co-GM brings about when it comes.'},
];
const RENAME_NODE='Its routes, what requires it and who arrives there follow. Game state keys on it: a game already played loses track of it under the old id.';

// ---------------------------------------------------------------------------------------------
// A node.

/** The inspector for a node: its kind and id, its title, its kind's fields, its lore, and the routes in and out. */
export function NodeInspector({node}:{node:SceneNode}){
  const {edit,confirm,doc,connectFrom,renamed}=useScene();
  const kind=nodeKind(node);
  const set=(key:string,value:unknown)=>edit(scene=>setNodeField(scene,node.id,key,value));
  const remove=()=>{
    const routes=doc.edges.filter(route=>route.source===node.id||route.target===node.id).length;
    confirm({title:'Delete node?',confirmLabel:'Delete node',description:`Delete “${node.data.title||node.id}”${routes?` and the ${routes} route${routes===1?'':'s'} to and from it`:''}? Routes that require it, or fail into it, forget it, and anyone who arrives there arrives from the start. You can undo this.`,onConfirm:()=>edit(scene=>removeNodes(scene,[node.id]))});
  };
  return <div className={`node-inspector ${kind}`} data-node={node.id}>
    <header className="inspector-header">
      {isBeat(node)&&<BeatKind node={node}/>}
      <IdField id={node.id} problem={next=>idProblem(next,doc.nodes.map(other=>other.id),node.id)} onRename={next=>{edit(scene=>renameNode(scene,node.id,next));renamed('node',node.id,next)}} warning={RENAME_NODE}/>
    </header>
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

/** A beat's kind, chosen: a discovery (with a revelation) or an event (without). What the other kind has no use for goes, after asking. */
function BeatKind({node}:{node:SceneNode<BeatData>}){
  const {doc,edit,confirm}=useScene();
  const kind=isDiscovery(node)?'discovery':'event';
  const change=(next:string)=>{
    if(next===kind)return;
    const d=node.data,title=d.title||node.id;
    if(next==='event'){
      const losing=[d.revelation?.trim()?'its revelation':'',d.paths?.length?`its ${d.paths.length} path${d.paths.length===1?'':'s'}`:'',d.required?'its required mark':''].filter(Boolean);
      if(!losing.length){edit(scene=>makeEvent(scene,node.id));return}
      confirm({title:'Make it an event?',confirmLabel:'Make it an event',description:`Make “${title}” an event, a turn the scene takes? ${sentence(losing)} go${losing.length===1?'es':''}: an event has none. You can undo this.`,onConfirm:()=>edit(scene=>makeEvent(scene,node.id))});
      return;
    }
    const arriving=doc.cast.filter(member=>member.enters===node.id).length,roles=Object.keys(d.cast??{}).length;
    const losing=[d.pressure!==undefined?'its pressure':'',roles?`its ${roles} conversation role${roles===1?'':'s'}`:'',arriving?`its ${arriving} arrival${arriving===1?'':'s'} (they're here from the start instead)`:''].filter(Boolean);
    if(!losing.length){edit(scene=>makeDiscovery(scene,node.id));return}
    confirm({title:'Make it a discovery?',confirmLabel:'Make it a discovery',description:`Make “${title}” a discovery, something the player can come to understand? ${sentence(losing)} go${losing.length===1?'es':''}: a discovery is never the scene's stage. You can undo this.`,onConfirm:()=>edit(scene=>makeDiscovery(scene,node.id))});
  };
  return <div className="beat-kind">
    <ChoiceField label="Kind" field="kind" value={kind} options={[{value:'discovery',label:'Discovery',detail:'Something the player can come to understand, by any of its paths.'},{value:'event',label:'Event',detail:'A turn the scene takes, and its new situation from then on.'}]} onChange={change}/>
  </div>;
}
const sentence=(parts:string[])=>{const text=parts.length>1?`${parts.slice(0,-1).join(', ')} and ${parts.at(-1)}`:parts[0]??'';return text.charAt(0).toUpperCase()+text.slice(1)};

function StartFields({node}:{node:SceneNode<StartData>}){
  const {edit}=useScene();
  return <>
    <TextArea label="Opening" field="description" rows={7} hint="The situation the player walks into, the suggested ways into it, how to play the people here, and an opening image." value={node.data.description} onChange={value=>edit(scene=>setNodeField(scene,node.id,'description',value))}/>
    <RolesEditor node={node} label="Conversation roles at the start" hint="Each person's role as the scene opens: the co-GM's first note. Behaviour, not meaning."/>
  </>;
}

function DiscoveryFields({node}:{node:SceneNode<BeatData>}){
  const {edit}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setNodeField(scene,node.id,key,value));
  return <>
    <Checkbox label="Required" field="required" hint="The scene can't end well without it: give it three paths or more, one needing no roll, and have a way into a good ending require it." checked={!!node.data.required} onChange={checked=>set('required',checked?true:undefined)}/>
    <TextArea label="Revelation" field="revelation" hint="What the player comes to understand, in a sentence or two." value={node.data.revelation??''} onChange={value=>set('revelation',value)}/>
    <TextArea label="How to play it" field="description" rows={4} hint="What the discovery is for and how to play it." value={node.data.description} onChange={value=>set('description',value)}/>
    <PathsEditor node={node}/>
    <Establishes node={node} hint="Settled when it's reached: the GM is told their sentences, and endings' effects test them."/>
    <CarryEditor node={node}/>
    {node.data.pressure!==undefined&&<Pressure node={node} hint="An event's: a discovery is never the stage, so this isn't used. Remove it, or make the beat an event."/>}
    {node.data.cast&&<RolesEditor node={node} label="Conversation roles here" hint="An event's: a discovery is never the stage, so these aren't used. Remove them, or make the beat an event."/>}
  </>;
}

function EventFields({node}:{node:SceneNode<BeatData>}){
  const {edit}=useScene();
  return <>
    <TextArea label="What happens" field="description" rows={5} hint="What happens, and what it puts to the player." value={node.data.description} onChange={value=>edit(scene=>setNodeField(scene,node.id,'description',value))}/>
    <Pressure node={node} hint="What the world does if the scene stalls here."/>
    <Arrivals node={node}/>
    <RolesEditor node={node} label="Conversation roles here" hint="Each person's role while the scene is here: the co-GM's suggestions. Behaviour, not meaning."/>
    <Establishes node={node} hint="Settled when the scene reaches it: the GM is told their sentences, and endings' effects test them."/>
    {node.data.paths!==undefined&&<PathsEditor node={node} note="An event has no paths (the rules say so): make it a discovery, or remove them."/>}
    {node.data.required!==undefined&&<Checkbox label="Required" field="required" hint="A discovery's: an event isn't required, so this isn't used. Untick it to take it out, or make the beat a discovery." checked={!!node.data.required} onChange={checked=>edit(scene=>setNodeField(scene,node.id,'required',checked?true:undefined))}/>}
    <CarryEditor node={node}/>
  </>;
}

function EndingFields({node}:{node:SceneNode<EndingData>}){
  const {edit,campaign,openScene}=useScene();
  const set=(key:string,value:unknown)=>edit(scene=>setNodeField(scene,node.id,key,value));
  const scenes:Option[]=[{value:'',label:'Nowhere: the story ends here'},...(campaign?.scenes??[]).filter(scene=>scene.id!==campaign?.talk).map(scene=>({value:scene.id,label:`${scene.title} (${scene.id})`}))];
  return <>
    <ChoiceField label="Result" field="result" value={node.data.result} options={RESULT_OPTIONS} onChange={value=>set('result',value)}/>
    <SelectField label="Exit kind" field="exitKind" hint={EXIT_OPTIONS[node.data.exitKind]?.detail} value={node.data.exitKind} options={EXIT_KINDS.map(kind=>({value:kind,label:EXIT_OPTIONS[kind].label}))} onChange={value=>set('exitKind',value)}/>
    <TextArea label="What's true" field="description" rows={4} hint="What is true if the scene ends this way." value={node.data.description} onChange={value=>set('description',value)}/>
    <TextArea label="Closing" field="closing" rows={4} hint="How the GM should close it: the feeling, the last image." value={node.data.closing} onChange={value=>set('closing',value)}/>
    <SelectField label="Next scene" field="next" hint="The scene the story goes on to: one of the campaign's." value={node.data.next??''} options={scenes} onChange={value=>set('next',value||undefined)}/>
    {node.data.next&&<button type="button" className="text-button" onClick={()=>openScene(node.data.next!)}>Open {node.data.next} <ArrowRight size={12}/></button>}
    <EffectsEditor label="Effects" field="effects" at={{kind:'node',id:node.id}} hint="What ending this way does to the story and the world, in order, each only when its facts say so."/>
    <WaysIn node={node}/>
  </>;
}

/** What an ending needs is in its routes' requires: each way in, and the beats it requires. */
function WaysIn({node}:{node:SceneNode}){
  const {doc,showRoute}=useScene();
  const routes=doc.edges.filter(route=>route.target===node.id);
  return <div className="ways-in" data-field="ways-in">
    <span className="field-label">Ways in</span>
    {!routes.length&&<p className="muted">No route comes here yet.</p>}
    {routes.map(route=><button type="button" key={route.id} className="way-in" onClick={()=>showRoute(route.id)}>
      <b>{route.label||route.id}</b>
      <small>from {titleOf(doc,route.source)}{route.data.requires?.length?` · requires ${route.data.requires.map(id=>titleOf(doc,id)).join(', ')}`:' · requires nothing'}</small>
    </button>)}
  </div>;
}

/** An event's pressure: optional, added and removed; emptied, it's taken out as it's left. */
function Pressure({node,hint}:{node:SceneNode<BeatData>;hint:string}){
  const {edit}=useScene();
  const set=(value:string|undefined)=>edit(scene=>setNodeField(scene,node.id,'pressure',value));
  return <OptionalSection title="Pressure" field="pressure" present={node.data.pressure!==undefined} addLabel="Add pressure" hint={hint} onRemove={()=>set(undefined)}>
    {close=><TextArea label="Pressure" hideLabel rows={3} hint={hint} value={node.data.pressure??''} onChange={set} onLeave={value=>{if(!value.trim()){set(undefined);close()}}}/>}
  </OptionalSection>;
}

/** Who arrives at an event: those whose `enters` it is, as chips; [+ Add person] moves someone here from wherever they entered. */
function Arrivals({node}:{node:SceneNode<BeatData>}){
  const {edit,doc,showCast}=useScene();
  const arriving=doc.cast.filter(member=>member.enters===node.id);
  const fromStart=doc.cast.filter(member=>member.enters===undefined);
  const options=doc.cast.filter(member=>member.enters!==node.id).map(member=>({value:member.id,label:`${member.name||member.id} (${member.id})`,detail:member.enters?`Arrives at ${titleOf(doc,member.enters)} now: moves here`:'Here from the start now'}));
  return <div className="arrivals" data-field="arrivals">
    <span className="field-label">Who arrives here<span className="count">{arriving.length}</span></span>
    <Chips label="Who arrives here" items={arriving.map(member=>({value:member.id,label:member.name||member.id,detail:`${member.id}: their card in the Cast view`,onOpen:()=>showCast(member.id,'enters')}))} empty="Nobody arrives here." onRemove={id=>edit(scene=>setArrival(scene,id,node.id,false))}/>
    <AddPicker label="Add person" title="Who arrives here" options={options} empty={doc.cast.length?'Everyone of the cast arrives here.':'The scene has no cast yet: add people in the Cast view.'} onPick={id=>edit(scene=>setArrival(scene,id,node.id,true))}/>
    <small className="field-hint">Everyone else is here from the start{fromStart.length?` (${fromStart.map(member=>member.name||member.id).join(', ')})`:''} or arrives at another event. Removed, they're here from the start.</small>
  </div>;
}

/**
 * The conversation roles at the start or an event: a card for each person with a role here (their note,
 * the co-GM's suggestion), and [+ Add role] for anyone else of the cast. A role is written once it has
 * words; one emptied is taken out as it's left.
 */
function RolesEditor({node,label,hint}:{node:SceneNode<StartData|BeatData>;label:string;hint:string}){
  const {edit,doc}=useScene();
  const notes=node.data.cast??{};
  const [drafts,setDrafts]=useState<string[]>([]);
  const shown=[...Object.keys(notes),...drafts.filter(id=>!(id in notes))];
  const write=(id:string,value:string|undefined)=>edit(scene=>updateNode(scene,node.id,data=>{
    const current=('cast' in data?data.cast:undefined)??{};
    const next=value===undefined?Object.fromEntries(Object.entries(current).filter(([who])=>who!==id)):withKey(current,id,value,[]);
    return withKey(data,'cast',Object.keys(next).length?next:undefined,ORDER[data.kind]);
  }));
  const remove=(id:string)=>{setDrafts(old=>old.filter(other=>other!==id));if(id in notes)write(id,undefined)};
  const where=(enters:string|undefined)=>enters===undefined?'Here from the start':enters===node.id?'Arrives here':`Arrives at ${titleOf(doc,enters)}`;
  const options=doc.cast.filter(member=>!shown.includes(member.id)).map(member=>({value:member.id,label:`${member.name||member.id} (${member.id})`,detail:where(member.enters)}));
  return <div className="roles-field" data-field="cast">
    <span className="field-label">{label}<span className="count">{Object.keys(notes).length}</span></span>
    {!shown.length&&<p className="muted">No roles here yet.</p>}
    {shown.map(id=>{
      const member=doc.cast.find(person=>person.id===id);
      const name=member?`${member.name||id} (${id})`:`${id} (not in the cast)`;
      return <article className="role-card" key={id} aria-label={`Role of ${member?.name||id}`}>
        <header><b>{member?.name||id}</b><code>{id}</code>{member&&<small>{where(member.enters)}</small>}<button type="button" className="icon-button" aria-label={`Remove ${member?.name||id}'s role`} title="Remove role" onClick={()=>remove(id)}><Trash2 size={13}/></button></header>
        <TextArea label={name} hideLabel rows={2} autoFocus={!(id in notes)} value={notes[id]??''} placeholder="What they do and hold back here: behaviour, not meaning." onChange={value=>{if(value.trim()||id in notes)write(id,value)}} onLeave={value=>{if(!value.trim())remove(id)}}/>
      </article>;
    })}
    <AddPicker label="Add role" title="A role for…" options={options} empty={doc.cast.length?'Everyone of the cast has a role here.':'The scene has no cast yet: add people in the Cast view.'} onPick={id=>setDrafts(old=>[...old,id])}/>
    <small className="field-hint">{hint}</small>
  </div>;
}

/** The facts a beat settles when it's reached. */
function Establishes({node,hint}:{node:SceneNode<BeatData>;hint:string}){
  return <FactsField hint={hint} facts={node.data.establishes??[]} set={(scene,change)=>{
    const now=scene.nodes.find(other=>other.id===node.id) as SceneNode<BeatData>|undefined;
    return setNodeField(scene,node.id,'establishes',optionalList(change(now?.data.establishes??[])));
  }}/>;
}

/** A discovery's paths: who or what holds it, the clue, what earns it, how strong it is, and a roll that suits it. */
function PathsEditor({node,note}:{node:SceneNode<BeatData>;note?:string}){
  const {edit,doc,place}=useScene();
  const listId=useId(),list=useRef<HTMLFieldSetElement>(null);
  const [focus,setFocus]=useState<number|null>(null);
  const paths=node.data.paths??[];
  const setPaths=(change:(paths:Path[])=>Path[])=>edit(scene=>updateNode(scene,node.id,data=>withKey(data,'paths',change((data as BeatData).paths??[]),ORDER.beat)));
  const setPath=(index:number,key:string,value:unknown)=>setPaths(old=>old.map((path,i)=>i===index?withKey(path,key,value,ORDER.path):path));
  useEffect(()=>{if(focus===null)return;list.current?.querySelector<HTMLElement>(`[data-field="paths.${focus}"] input`)?.focus();setFocus(null)},[focus]);
  const vias=useMemo(()=>[
    ...doc.cast.map(member=>({value:member.id,label:member.name})),
    ...(place?.things??[]).map(thing=>({value:thing.name,label:`a thing of ${place!.name}`})),
    ...(place?.areas??[]).map(area=>({value:area.name,label:`a part of ${place!.name}`})),
  ],[doc.cast,place]);
  const required=!!node.data.required;
  return <fieldset className="paths" data-field="paths" ref={list}>
    <legend className="field-label">Paths <span className="count">{paths.length}</span></legend>
    <small className="field-hint">{note??`Ways it can come out: examples, not a sequence. ${required?'Required: three or more, one with no roll.':'Two or more.'}`}</small>
    <datalist id={listId}>{vias.map(via=><option key={`${via.value}:${via.label}`} value={via.value}>{via.label}</option>)}</datalist>
    {paths.map((path,index)=><ItemCard key={index} index={index} count={paths.length} field={`paths.${index}`} className="path" label={`Path ${index+1}`} removeLabel="Remove path"
      title={path.via||'Via…'} badges={<><span className={`strength ${path.strength}`}>{path.strength}</span>{path.check&&<span className="dice-badge"><Dices size={11}/>{SKILL_LABEL(path.check.skill)} {path.check.dc}</span>}</>}
      onMove={by=>setPaths(old=>moved(old,index,by))} onRemove={()=>setPaths(old=>old.filter((_,i)=>i!==index))}>
      <TextField label="Via" field="via" list={listId} hint="A cast id, or a thing or place in a few words (“the body”)." value={path.via} onChange={value=>setPath(index,'via',value)}/>
      <TextArea label="Clue" field="clue" rows={2} hint="What's there to find or hear, concretely." value={path.clue} onChange={value=>setPath(index,'clue',value)}/>
      <TextArea label="Earn" field="earn" rows={2} hint="What earns it: free to a look, a kindness, a promise, a roll. Say when it's free." value={path.earn} onChange={value=>setPath(index,'earn',value)}/>
      <ChoiceField label="Strength" field="strength" value={path.strength} options={STRENGTH_OPTIONS} onChange={value=>setPath(index,'strength',value)}/>
      <OptionalSection title="Roll" field="check" present={!!path.check} addLabel="Add a roll" hint="A roll that suits this path: the mouthpiece calls it when the player tries it and the outcome is uncertain." onRemove={()=>setPath(index,'check',undefined)}>
        <div className="field-row">
          <SelectField label="Skill" field="skill" value={path.check?.skill??''} placeholder="Choose a skill…" options={SKILL_OPTIONS} onChange={skill=>setPath(index,'check',path.check?withKey(path.check,'skill',skill,ORDER.check):{skill,dc:12})}/>
          <NumberField label="DC" field="dc" min={1} max={30} disabled={!path.check} value={path.check?.dc??12} onChange={dc=>{if(dc!==undefined&&path.check)setPath(index,'check',withKey(path.check,'dc',dc,ORDER.check))}}/>
        </div>
      </OptionalSection>
    </ItemCard>)}
    <button type="button" className="add-item" onClick={()=>{setPaths(old=>[...old,{via:'',clue:'',earn:'',strength:'suggestive'}]);setFocus(paths.length)}}><Plus size={13}/>Add path</button>
  </fieldset>;
}

/** When the rest of the story needs a beat too: what it opens up, what later needs it, the things it's in. */
function CarryEditor({node}:{node:SceneNode<BeatData>}){
  const {edit,place,campaign,doc}=useScene();
  const carry=node.data.carry;
  const set=(change:(carry:NonNullable<BeatData['carry']>)=>BeatData['carry'])=>edit(scene=>{
    const now=(scene.nodes.find(other=>other.id===node.id)?.data as BeatData|undefined)?.carry;
    return setNodeField(scene,node.id,'carry',now?change(now):undefined);
  });
  const elsewhere=carriedElsewhere(campaign?.scenes.map(scene=>scene.doc).filter((other):other is SceneDocument=>!!other&&other.id!==doc.id)??[]);
  const names=new Map<string,string>([...(place?.things??[]).map(thing=>[thing.id,thing.name] as [string,string]),...elsewhere.map(id=>[id,`${id} (carried from another scene)`] as [string,string])]);
  const things=carry?.things??[];
  const options=[...names].filter(([id])=>!things.includes(id)).map(([id,name])=>({value:id,label:name,detail:id}));
  return <OptionalSection title="The story carries it" field="carry" present={!!carry} addLabel="The story carries it" className="carry"
    hint="Missed, the story owes it to the player in the next scene that can hold it." onAdd={()=>edit(scene=>setNodeField(scene,node.id,'carry',{unlocks:''}))} onRemove={()=>edit(scene=>setNodeField(scene,node.id,'carry',undefined))}>
    <TextArea label="Unlocks" field="unlocks" rows={2} hint="What it opens up." value={carry?.unlocks??''} onChange={value=>set(old=>withKey(old,'unlocks',value,ORDER.carry))}/>
    <TextArea label="Later" field="later" rows={2} hint="What later needs it." value={carry?.later??''} onChange={value=>set(old=>withKey(old,'later',value.trim()?value:undefined,ORDER.carry))}/>
    <div className="field" data-field="things">
      <span className="field-label">Things</span>
      <Chips label="Things" items={things.map(id=>({value:id,label:names.get(id)??id,detail:id}))} empty="None." onRemove={id=>set(old=>withKey(old,'things',optionalList((old.things??[]).filter(other=>other!==id)),ORDER.carry))}/>
      <AddPicker label="Add thing" title="A thing it's in" options={options} empty="The scene's place has no other things." onPick={id=>set(old=>withKey(old,'things',[...(old.things??[]),id],ORDER.carry))}/>
      <small className="field-hint">The things of the place it's in (Prout's page in Cob's boot).</small>
    </div>
  </OptionalSection>;
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
  return <details className="route-list" open data-field="routes">
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
      {!open&&<code>{route.id}</code>}
      <span>{d.phase==='cue'?'Cue':'Outcome'}</span>
      {d.skill&&<span className="dice-badge"><Dices size={11}/>{SKILL_LABEL(d.skill)} DC {d.dc}</span>}
      {d.requires?.length?<span>Requires {d.requires.map(id=>titleOf(doc,id)).join(', ')}</span>:null}
      {d.onFailure&&<span>Fails to {titleOf(doc,d.onFailure)}</span>}
    </div>
    {open?<RouteFields route={route} onRemove={remove}/>:<p className="way-condition">{d.condition||'No condition: taken when the revelation has landed.'}</p>}
  </article>;
}

function RouteFields({route,onRemove}:{route:Route;onRemove:()=>void}){
  const {doc,edit,showNode,renamed}=useScene();
  const d=route.data;
  const set=(key:string,value:unknown)=>edit(scene=>setRouteField(scene,route.id,key,value));
  const target=doc.nodes.find(node=>node.id===route.target);
  const requires=d.requires??[];
  const beats:Option[]=doc.nodes.filter(isBeat).filter(node=>node.id!==route.target&&!requires.includes(node.id)).map(node=>({value:node.id,label:`${node.data.title||node.id} (${node.id})`,detail:isDiscovery(node)?'Discovery':'Event'}));
  const nodes:Option[]=doc.nodes.filter(node=>node.id!==route.source).map(node=>({value:node.id,label:`${node.data.title||node.id} (${node.id})`}));
  const setRequires=(change:(ids:string[])=>string[])=>edit(scene=>setRouteField(scene,route.id,'requires',optionalList(change(scene.edges.find(other=>other.id===route.id)?.data.requires??[]))));
  return <div className="way-fields">
    <IdField id={route.id} problem={next=>idProblem(next,doc.edges.map(other=>other.id),route.id)} onRename={next=>{edit(scene=>renameRoute(scene,route.id,next));renamed('route',route.id,next)}} warning="The co-GM moves the scene by it, and game state keys on it: a game already played loses track of it under the old id."/>
    <TextField label="Label" field="label" hint="The route's name on the graph." value={route.label} onChange={value=>edit(scene=>updateRoute(scene,route.id,old=>({...old,label:value})))}/>
    <TextArea label="Condition" field="condition" hint={target&&isDiscovery(target)?'What has to have happened, in prose. Into a discovery it may be empty: the route is taken when the revelation has landed.':'What has to have happened in the story to take it, in prose.'} value={d.condition} onChange={value=>set('condition',value)}/>
    <ChoiceField label="Phase" field="phase" value={d.phase} options={PHASE_OPTIONS} onChange={value=>set('phase',value)}/>
    <div className="requires-field" data-field="requires">
      <span className="field-label">Requires<span className="count">{requires.length}</span></span>
      <Chips label="Requires" items={requires.map(id=>({value:id,label:titleOf(doc,id),detail:id,onOpen:()=>showNode(id)}))} empty="Nothing: it can be taken once its condition has happened." onRemove={id=>setRequires(ids=>ids.filter(other=>other!==id))}/>
      <AddPicker label="Add beat" title="Require a beat" options={beats} empty="Every beat is required already." onPick={id=>setRequires(ids=>[...ids,id])}/>
      <small className="field-hint">Beats that must have been reached first: an ending's evidence, the lead.</small>
    </div>
    <OptionalSection title="Roll" field="skill" present={!!d.skill||d.onFailure!==undefined} addLabel="Add a roll" hint="No roll: the route can't fail, and it's taken once its condition has happened."
      onRemove={()=>edit(scene=>setRouteField(setRouteField(scene,route.id,'skill',''),route.id,'onFailure',undefined))}>
      <div className="field-row">
        <SelectField label="Skill" field="skill" value={d.skill} placeholder="Choose a skill…" options={SKILL_OPTIONS} onChange={value=>set('skill',value)}/>
        <NumberField label="DC" field="dc" min={1} max={30} disabled={!d.skill} value={d.dc} onChange={value=>{if(value!==undefined)set('dc',value)}}/>
      </div>
      <SelectField label="On failure" field="onFailure" hint="Where a failed roll goes; or the scene stays where it is, and the route stays open to try again." value={d.onFailure??''} options={[{value:'',label:'Stays where it is'},...nodes]} onChange={value=>set('onFailure',value||undefined)}/>
      <small className="field-hint">The roll decides it: when the player attempts what the condition says, the mouthpiece calls it, and a success takes the route (its facts settled then).</small>
    </OptionalSection>
    <FactsField label="Facts settled when it's taken" hint="A route with a roll settles them on a success." facts={d.establishes??[]} set={(scene,change)=>setRouteField(scene,route.id,'establishes',optionalList(change(scene.edges.find(other=>other.id===route.id)?.data.establishes??[])))}/>
    <button type="button" className="text-button danger" onClick={onRemove}><Trash2 size={13}/>Remove route</button>
  </div>;
}
