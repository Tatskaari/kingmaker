// The scenario's own fields, each group in a view of the main area beside the diagram's: the Scenario
// view (the campaign, its start, the starting purse, the world a backstory is written for), the Files
// view (the story's scenes in order, the talk template, the maps and the places, each saying where the
// other files name it), and the Quests view (each quest, and the scenes' effects that name it).
import React,{useState} from 'react';
import {Plus,X} from 'lucide-react';
import {AddPicker,Group,IdField,ItemCard,NumberField,SelectField,TextArea,TextField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {TIMES} from '../map/model.ts';
import {TileFields} from '../map/inspectors.tsx';
import {moved,slugOf,uniqueId,withKey} from '../campaign/json.ts';
import type {CampaignFiles} from '../campaign/files.ts';
import type {FileChange} from '../campaign/edits.ts';
import {NewFile,NewFileForm,OtherKeys,Uses,ViewIndex,plural} from '../campaign/views.tsx';
import type {NewKind,Use} from '../campaign/views.tsx';
import {ORDER,mapUsesOf,placeUsesOf,questKeyProblem,questUsesOf,sceneUsesOf,setCreationField,setScenarioField,setStartField,withStart} from './model.ts';
import type {ScenarioDocument,Tile2} from './model.ts';

export type Lists='scenes'|'maps'|'places';
export const LIST_OF:Record<NewKind,Lists>={scene:'scenes',map:'maps',place:'places'};

/** What the scenario's views ask of the editor. */
export type ScenarioActions={
  /** The scenario changed (its own file; typing in a field is one step). */
  edit:(next:ScenarioDocument)=>void;
  /** A new file of the campaign made and listed, and with `pick` applied to the scenario (it's the first scene, the start map…) and `others` written beside it, as one step. */
  make:(kind:NewKind,title:string,id:string,then?:{pick?:(doc:ScenarioDocument)=>ScenarioDocument;others?:()=>FileChange[];unlisted?:boolean})=>void;
  /** Take something out of the scenario's lists, after asking (the file stays). */
  unlist:(kind:Lists,key:string)=>void;
  open:(path:string)=>void;
  /** Where a way into a map lands by default. */
  landing:(map:string)=>Tile2;
  /** A quest's key renamed, in the scenario and in every scene's effect naming it. */
  renameQuest:(from:string,to:string)=>void;
  /** A quest taken out, after asking (saying which effects name it). */
  removeQuest:(key:string)=>void;
};

type Props={doc:ScenarioDocument;campaign:CampaignFiles|null;actions:ScenarioActions};

const TIME_OPTIONS:Option[]=TIMES.map(time=>({value:time,label:time.replace('-',' ')}));
const fileTitle=(campaign:CampaignFiles|null,kind:Lists,key:string)=>((kind==='scenes'?campaign?.scenes:kind==='maps'?campaign?.maps:campaign?.places)?.find(file=>file.key===key)?.doc as {title?:string}|undefined)?.title||key;
const pathOf=(campaign:CampaignFiles|null,kind:Lists,key:string)=>`${campaign?.root??''}${kind}/${key}.${kind==='scenes'?'kmscene':kind==='maps'?'kmmap':'kmplace'}`;
const listOptions=(doc:ScenarioDocument,campaign:CampaignFiles|null,kind:Lists,none?:string):Option[]=>[...(none!==undefined?[{value:'',label:none}]:[]),...doc[kind].map(key=>({value:key,label:`${fileTitle(campaign,kind,key)} (${key})`}))];

// ---------------------------------------------------------------------------------------------
// The Scenario view.

const SCENARIO_GROUPS:Array<[string,string]>=[['scenario-campaign','The campaign'],['scenario-start','The start'],['scenario-purse','The starting purse'],['scenario-backstory','The backstory\'s world']];

export function ScenarioView({doc,campaign,actions}:Props){
  const set=(key:string,value:unknown)=>actions.edit(setScenarioField(doc,key,value));
  return <div className="view-content scenario-view">
    <ViewIndex label="The scenario's groups" groups={SCENARIO_GROUPS}/>
    <Group title="The campaign" anchor="scenario-campaign" field="campaign">
      <TextField label="Title" field="title" value={doc.title} onChange={value=>set('title',value)}/>
      <IdField id={doc.id} label="Scenario id" problem={next=>/^[a-z0-9][a-z0-9-]*$/.test(next)?undefined:'An id is a slug: lower-case letters, digits and dashes.'} onRename={next=>set('id',next)}
        warning="It's the file's name (rename the file to match: the problems say until it does) and the campaign's id, which games are installed by (id@version)."/>
      <TextArea label="Description" field="description" rows={3} value={doc.description} onChange={value=>set('description',value)}/>
      <div className="field-row">
        <TextField label="Campaign version" field="campaignVersion" hint="The campaign's own (installed as id@version)." value={doc.campaignVersion??''} onChange={value=>set('campaignVersion',value)}/>
        <NumberField label="Level" field="level" min={1} max={20} hint="The character's level as the story starts." value={doc.level} onChange={value=>set('level',value)}/>
      </div>
      <TextField label="Rules pack" field="rulesPack" hint="The rules engine's content pack (starter-pack@0.1.0)." value={doc.rulesPack} onChange={value=>set('rulesPack',value)}/>
      <OtherKeys value={doc} known={ORDER.scenario} onChange={set}/>
    </Group>
    <StartGroup doc={doc} campaign={campaign} actions={actions}/>
    <PurseGroup doc={doc} edit={actions.edit}/>
    <BackstoryGroup doc={doc} campaign={campaign} edit={actions.edit}/>
  </div>;
}

/** The start: the first scene, the start place, the day and time, and the map and tile the player starts walking on. */
function StartGroup({doc,campaign,actions}:Props){
  const set=(key:string,value:unknown)=>actions.edit(setScenarioField(doc,key,value));
  const startMap=(map:string|undefined,at?:Tile2)=>actions.edit(withStart(doc,map,map?(at??(map===doc.start.map&&doc.start.at?{x:doc.start.at[0],y:doc.start.at[1]}:actions.landing(map))):undefined));
  const present=(kind:Lists)=>campaign?.present[kind]??[];
  return <Group title="The start" anchor="scenario-start" field="start" hint="When the story starts, and where the player starts walking.">
    <SelectField label="First scene" field="firstScene" hint="The story's first lead (or, with no start map, the scene it opens in)." value={doc.firstScene} options={listOptions(doc,campaign,'scenes','None yet')} onChange={value=>set('firstScene',value)}/>
    <NewFile kind="scene" label="New scene, the first" taken={present('scenes')} onCreate={(title,id)=>actions.make('scene',title,id,{pick:next=>setScenarioField(next,'firstScene',id)})}/>
    <SelectField label="Start place" field="startPlace" hint="The place a scene with none of its own is played in." value={doc.startPlace} options={listOptions(doc,campaign,'places','None yet')} onChange={value=>set('startPlace',value)}/>
    <NewFile kind="place" label="New place, the start place" taken={present('places')} onCreate={(title,id)=>actions.make('place',title,id,{pick:next=>setScenarioField(next,'startPlace',id)})}/>
    <div className="field-row">
      <NumberField label="Day" field="start.day" min={1} max={999} value={doc.start.day} onChange={value=>actions.edit(setStartField(doc,'day',value))}/>
      <SelectField label="Time" field="start.time" value={doc.start.time} options={TIME_OPTIONS} onChange={value=>actions.edit(setStartField(doc,'time',value))}/>
    </div>
    <SelectField label="Start map" field="start.map" hint="Where the player starts walking; none, and the first scene opens at once." value={doc.start.map??''} options={listOptions(doc,campaign,'maps','None: the first scene opens at once')} onChange={value=>startMap(value||undefined)}/>
    <NewFile kind="map" label="New map, the start" taken={present('maps')} onCreate={(title,id)=>actions.make('map',title,id,{pick:next=>withStart(next,id,actions.landing(id))})}/>
    {doc.start.map&&doc.start.at&&<TileFields label="Start tile" field="start.at" at={{x:doc.start.at[0],y:doc.start.at[1]}} onChange={at=>startMap(doc.start.map,at)}/>}
    {doc.start.map&&<p className="field-hint">Or drag the flag on the map itself: <button type="button" className="text-button" onClick={()=>actions.open(pathOf(campaign,'maps',doc.start.map!))}>open {doc.start.map}</button>.</p>}
  </Group>;
}

/** The starting purse: a card a coin, each removable, and [+ Add coin]. */
function PurseGroup({doc,edit}:{doc:ScenarioDocument;edit:(next:ScenarioDocument)=>void}){
  const purse=doc.startingPurse;
  const setPurse=(next:typeof purse)=>edit(setScenarioField(doc,'startingPurse',next));
  const setCoin=(index:number,key:string,value:unknown)=>setPurse(purse.map((coin,i)=>i===index?withKey(coin,key,value,ORDER.coin):coin));
  return <Group title="The starting purse" anchor="scenario-purse" field="startingPurse" hint="What the player carries as the story starts: each coin, how many, and what it is.">
    {!purse.length&&<p className="muted">Nothing: the player starts with an empty purse.</p>}
    {purse.map((coin,index)=><ItemCard key={index} index={index} count={purse.length} title={coin.name||'A coin'} label={`Coin ${index+1}`} onMove={by=>setPurse(moved(purse,index,index+by))} onRemove={()=>setPurse(purse.filter((_,i)=>i!==index))} removeLabel="Remove coin" field={`startingPurse.${index}`}>
      <div className="field-row">
        <TextField label="Coin" field="name" value={coin.name} onChange={value=>setCoin(index,'name',value)}/>
        <NumberField label="How many" field="quantity" min={0} max={99999} value={coin.quantity} onChange={value=>setCoin(index,'quantity',value)}/>
      </div>
      <TextField label="Coin description" field="description" value={coin.description} onChange={value=>setCoin(index,'description',value)}/>
    </ItemCard>)}
    <button type="button" className="add-item" onClick={()=>setPurse([...purse,{name:'',quantity:1,description:''}])}><Plus size={13}/>Add coin</button>
  </Group>;
}

/** The world a backstory is written for: its name and premise, the primer, the docs that aren't canon, and the places' docs with the words that call them up. */
function BackstoryGroup({doc,campaign,edit}:{doc:ScenarioDocument;campaign:CampaignFiles|null;edit:(next:ScenarioDocument)=>void}){
  const creation=doc.creation;
  const set=(key:string,value:unknown)=>edit(setCreationField(doc,key,value));
  const lore=(campaign?.lore??[]).filter(path=>path.endsWith('.md'));
  const loreOption=(path:string):Option=>({value:path,label:path.split('/').at(-1)!.replace(/\.md$/,''),detail:`lore/${path}`});
  const places=creation.places;
  const setPlace=(index:number,key:string,value:string)=>set('places',places.map((place,i)=>i===index?withKey(place,key,value,ORDER.creationPlace):place));
  return <Group title="The world a backstory is written for" anchor="scenario-backstory" field="creation" hint="What the character's backstory is written against, as a game begins.">
    <TextField label="World" field="creation.name" hint="The world's name, for a primer doc without a title." value={creation.name} onChange={value=>set('name',value)}/>
    <TextArea label="Premise" field="creation.premise" rows={6} hint="The story the backstory leads into: why they took this case, and that the story's people don't know them yet." value={creation.premise} onChange={value=>set('premise',value)}/>
    <SelectField label="Primer" field="creation.primer" hint="The lore doc that tells of the world." value={creation.primer} options={[{value:'',label:'None'},...lore.map(path=>({value:path,label:path}))]} onChange={value=>set('primer',value)}/>
    <fieldset className="lore-chips" data-field="creation.notCanon">
      <legend className="field-label">Not canon</legend>
      {!creation.notCanon.length&&<p className="muted">Every World doc is canon.</p>}
      <ul className="chips" aria-label="Not canon">{creation.notCanon.map(path=><li className="chip" key={path} title={`lore/${path}`}><span>{path}</span><button type="button" className="chip-remove" aria-label={`Remove ${path}`} onClick={()=>set('notCanon',creation.notCanon.filter(other=>other!==path))}><X size={12}/></button></li>)}</ul>
      <AddPicker label="Add a doc" title="A World doc the lore check doesn't read" options={lore.filter(path=>!creation.notCanon.includes(path)).map(loreOption)} onPick={path=>set('notCanon',[...creation.notCanon,path])} empty="Every lore doc is here already."/>
      <small className="field-hint">World docs the lore check doesn't read (how the world stands now, its fronts, the index).</small>
    </fieldset>
    <div className="creation-places" data-field="creation.places">
      <span className="field-label">Places a backstory can call up</span>
      {places.map((place,index)=><ItemCard key={index} index={index} count={places.length} title={place.doc||'A place doc'} label={`Place doc ${index+1}`} onRemove={()=>set('places',places.filter((_,i)=>i!==index))} removeLabel="Remove place doc">
        <SelectField label={`Place doc ${index+1}`} value={place.doc} options={lore.map(path=>({value:path,label:path}))} onChange={value=>setPlace(index,'doc',value)}/>
        <TextField label={`Words ${index+1}`} hint="What calls it up: a regular expression, read without case (granary|corn exchange)." value={place.words} onChange={value=>setPlace(index,'words',value)}/>
      </ItemCard>)}
      <AddPicker label="Add a place doc" title="The doc of a place a backstory can call up" options={lore.filter(path=>!places.some(place=>place.doc===path)).map(loreOption)} onPick={path=>set('places',[...places,{doc:path,words:slugOf(path.split('/').at(-1)!.replace(/\.md$/,'')).replace(/-/g,' ')}])}/>
    </div>
  </Group>;
}

// ---------------------------------------------------------------------------------------------
// The Files view.

const FILE_GROUPS:Array<[string,string]>=[['files-scenes','The story\'s scenes'],['files-talk','The talk template'],['files-maps','Maps'],['files-places','Places']];

export function FilesView({doc,campaign,actions}:Props){
  const talkChoices=(campaign?.present.scenes??[]).filter(key=>!doc.scenes.includes(key));
  return <div className="view-content files-view">
    <header className="view-header"><h2>Files</h2><p className="view-lede">The scenes, maps and places the scenario lists: the game installs these, and nothing else of the folder. Each says where the campaign's other files name it.</p></header>
    <ViewIndex label="The scenario's files" groups={FILE_GROUPS}/>
    <Group title="The story's scenes" anchor="files-scenes" field="scenes" hint="In the story's order. An ending's next goes on to one; a region of a map plays one.">
      {doc.scenes.map((key,index)=><SceneCard key={key} id={key} index={index} doc={doc} campaign={campaign} actions={actions}/>)}
      <AddFile kind="scene" doc={doc} campaign={campaign} actions={actions}/>
    </Group>
    <Group title="The talk template" anchor="files-talk" field="talk" hint="A word with whoever walks with the player between scenes: a scene file, never one of the story's scenes.">
      <SelectField label="Talk template" field="talk" value={doc.talk??''} options={[{value:'',label:'None'},...talkChoices.map(key=>({value:key,label:key}))]} onChange={value=>actions.edit(setScenarioField(doc,'talk',value||undefined))}/>
      <NewFile kind="scene" label="New scene, the talk template" taken={campaign?.present.scenes} onCreate={(title,id)=>actions.make('scene',title,id,{unlisted:true,pick:next=>setScenarioField(next,'talk',id)})}/>
      {doc.talk&&<button type="button" className="text-button" onClick={()=>actions.open(pathOf(campaign,'scenes',doc.talk!))}>Open {doc.talk}</button>}
    </Group>
    <Group title="Maps" anchor="files-maps" field="maps" hint="The maps walked between scenes (maps/<id>.kmmap).">
      {doc.maps.map((key,index)=><MapCard key={key} id={key} index={index} doc={doc} campaign={campaign} actions={actions}/>)}
      <AddFile kind="map" doc={doc} campaign={campaign} actions={actions}/>
    </Group>
    <Group title="Places" anchor="files-places" field="places" hint="The scenes' places (places/<id>.kmplace): where each scene is played.">
      {doc.places.map((key,index)=><PlaceCard key={key} id={key} index={index} doc={doc} campaign={campaign} actions={actions}/>)}
      <AddFile kind="place" doc={doc} campaign={campaign} actions={actions}/>
    </Group>
  </div>;
}

type CardProps=Props&{id:string;index:number};

/** A card for one of the scenario's files: its title (opening it), its id, and where it's named. */
function FileCard({kind,id,index,doc,campaign,actions,children,ordered}:CardProps&{kind:Lists;children:React.ReactNode;ordered?:boolean}){
  const file=(kind==='scenes'?campaign?.scenes:kind==='maps'?campaign?.maps:campaign?.places)?.find(f=>f.key===id);
  const status=!campaign?'':!file||file.text===undefined?' · no file':file.error?' · can\'t be read':'';
  return <ItemCard index={index} count={doc[kind].length} label={`${kind==='scenes'?'Scene':kind==='maps'?'Map':'Place'} ${id}`} field={`${kind}.${index}`} className="file-card"
    title={<button type="button" className="file-open" title={`Open ${pathOf(campaign,kind,id)}`} onClick={()=>actions.open(file?.path??pathOf(campaign,kind,id))}>{fileTitle(campaign,kind,id)}</button>}
    badges={<code>{id}{status}</code>}
    onMove={ordered?by=>actions.edit(setScenarioField(doc,kind,moved(doc[kind],index,index+by))):undefined}
    onRemove={()=>actions.unlist(kind,id)} removeLabel="Take it out of the scenario">
    {children}
  </ItemCard>;
}

function SceneCard(props:CardProps){
  const {id,doc,campaign,actions}=props;
  if(!campaign)return <FileCard kind="scenes" ordered {...props}><p className="muted">Reading the campaign…</p></FileCard>;
  const uses=sceneUsesOf(id,doc,campaign);
  const openMap=(map:string)=>()=>actions.open(pathOf(campaign,'maps',map));
  const openScene=(scene:string)=>()=>actions.open(pathOf(campaign,'scenes',scene));
  const played:Use[]=uses.regions.map(region=>({key:`${region.map}:${region.region}`,label:`${region.name}, ${region.mapTitle}`,detail:region.lays?'lays its place':'opens it',onOpen:openMap(region.map)}));
  const from:Use[]=[...(uses.first?[{key:'first',label:'The story\'s first lead',detail:'the scenario\'s start'}]:[]),...uses.from.map(ending=>({key:`${ending.scene}:${ending.ending}`,label:`${ending.sceneTitle}: ${ending.title}`,detail:'an ending',onOpen:openScene(ending.scene)}))];
  const next:Use[]=uses.next.map(ending=>({key:ending.ending,label:ending.title,detail:ending.next?`→ ${fileTitle(campaign,'scenes',ending.next)}`:'the story ends',...(ending.next?{onOpen:openScene(ending.next)}:{})}));
  return <FileCard kind="scenes" ordered {...props}>
    <div className="file-uses">
      <Uses title="Played at" uses={played} none="No region of a map plays it: it's reached by an ending, or not at all."/>
      <Uses title="Comes from" uses={from} none="Nothing goes on to it."/>
      <Uses title="Goes on to" uses={next} none="It has no endings yet."/>
      <Uses title="Its place" uses={uses.place?[{key:uses.place,label:fileTitle(campaign,'places',uses.place),detail:uses.place,onOpen:()=>actions.open(pathOf(campaign,'places',uses.place!))}]:[]} none="None: it's played in the start place."/>
    </div>
  </FileCard>;
}

function MapCard(props:CardProps){
  const {id,doc,campaign,actions}=props;
  if(!campaign)return <FileCard kind="maps" {...props}><p className="muted">Reading the campaign…</p></FileCard>;
  const uses=mapUsesOf(id,doc,campaign),map=campaign.maps.find(file=>file.key===id)?.doc;
  const openMap=(key:string)=>()=>actions.open(pathOf(campaign,'maps',key));
  return <FileCard kind="maps" {...props}>
    {map&&<p className="muted">{Math.max(0,...map.grid.map(row=>[...row].length))} × {map.grid.length} tiles · {plural(map.regions.length,'region')} · {plural(map.exits.length,'exit')} · {plural(map.people?.length??0,'person','people')}{uses.start?' · the story starts here':''}</p>}
    <div className="file-uses">
      <Uses title="Ways out" uses={uses.out.map(way=>({key:`${way.to}:${way.label}`,label:way.label||`to ${way.to}`,detail:`→ ${fileTitle(campaign,'maps',way.to)}${way.count>1?` · ${way.count} tiles`:''}`,onOpen:openMap(way.to)}))} none="None: nobody walks off it."/>
      <Uses title="Ways in" uses={uses.into.map(way=>({key:`${way.from}:${way.label}`,label:way.label,detail:`from ${way.fromTitle}${way.count>1?` · ${way.count} tiles`:''}`,onOpen:openMap(way.from)}))} none={uses.start?'None but the start.':'None: no way leads here from another map.'}/>
      <Uses title="Plays" uses={uses.plays.map(play=>({key:play.region,label:play.name,detail:`${play.lays?'lays':'opens'} ${fileTitle(campaign,'scenes',play.scene)}`,onOpen:()=>actions.open(pathOf(campaign,'scenes',play.scene))}))} none="No region of it plays a scene."/>
    </div>
  </FileCard>;
}

function PlaceCard(props:CardProps){
  const {id,doc,campaign,actions}=props;
  if(!campaign)return <FileCard kind="places" {...props}><p className="muted">Reading the campaign…</p></FileCard>;
  const uses=placeUsesOf(id,doc,campaign),place=campaign.places.find(file=>file.key===id)?.doc;
  return <FileCard kind="places" {...props}>
    {place&&<p className="muted">{place.size.w} × {place.size.h} feet · {plural(place.areas.length,'area')} · {plural(place.things.length,'thing')} · {plural(Object.keys(place.people).length,'start')}{uses.start?' · the start place':''}</p>}
    <div className="file-uses">
      <Uses title="Played in by" uses={uses.scenes.map(scene=>({key:scene.key,label:scene.title,detail:scene.key,onOpen:()=>actions.open(pathOf(campaign,'scenes',scene.key))}))} none="No scene is played in it (a scene's Place names it)."/>
      <Uses title="Laid on" uses={uses.laid.map(at=>({key:`${at.map}:${at.region}`,label:`${at.name}, ${at.mapTitle}`,detail:`from (${at.origin.x}, ${at.origin.y})`,onOpen:()=>actions.open(pathOf(campaign,'maps',at.map))}))} none="No region lays it on a map."/>
    </div>
  </FileCard>;
}

/** [+ Add scene] (or map, or place): one of the folder's files the scenario doesn't list yet, or a new one. */
function AddFile({kind,doc,campaign,actions}:Props&{kind:NewKind}){
  const list=LIST_OF[kind];
  const unlisted=(campaign?.present[list]??[]).filter(key=>!doc[list].includes(key)&&!(kind==='scene'&&key===doc.talk));
  return <AddPicker label={`Add ${kind}`} title={`Add a ${kind} to the scenario`} options={unlisted.map(key=>({value:key,label:key,detail:`${list}/${key}: in the folder, not listed yet`}))} onPick={key=>actions.edit(setScenarioField(doc,list,[...doc[list],key]))}>
    {close=><div className="new-fact"><NewFileForm kind={kind} taken={campaign?.present[list]} onCreate={(title,id)=>actions.make(kind,title,id)} onDone={close}/></div>}
  </AddPicker>;
}

// ---------------------------------------------------------------------------------------------
// The Quests view.

export function QuestsView({doc,campaign,actions}:Props){
  const quests=Object.entries(doc.quests??{});
  return <div className="view-content quests-view">
    <header className="view-header"><h2>Quests</h2><p className="view-lede">The story's quests, by their keys: a scene's quest effect names one (begins it, moves it on, ends it) and the journal shows its title. Each says which effects name it.</p></header>
    {!quests.length&&<p className="muted">No quests yet.</p>}
    {quests.map(([key,title],index)=><QuestCard key={key} id={key} title={title} index={index} count={quests.length} doc={doc} campaign={campaign} actions={actions}/>)}
    <NewQuest doc={doc} actions={actions}/>
  </div>;
}

function QuestCard({id,title,index,count,doc,campaign,actions}:Props&{id:string;title:string;index:number;count:number}){
  const uses=campaign?questUsesOf(id,campaign):[];
  const setTitle=(value:string)=>actions.edit(setScenarioField(doc,'quests',{...doc.quests,[id]:value}));
  return <ItemCard index={index} count={count} title={title||id} label={`Quest ${id}`} field={`quests.${id}`} onRemove={()=>actions.removeQuest(id)} removeLabel="Remove quest" className="quest-card">
    <TextField label="Quest title" field="title" hint="What the journal calls it." value={title} onChange={setTitle}/>
    <IdField id={id} label="Quest key" problem={next=>questKeyProblem(doc,next,id)} onRename={next=>actions.renameQuest(id,next)}
      warning={`Every effect naming it (${plural(uses.length,'effect')}) follows, in its scene's file. Game state keys on it: a game already played loses track of it under the old key.`}/>
    <Uses title="Named by" uses={uses.map(use=>({key:`${use.scene}:${use.at.kind==='ending'?use.at.id:'onEnd'}:${use.index}`,label:`${use.sceneTitle}: ${use.at.kind==='ending'?use.at.title:'on every ending'}`,detail:`effect ${use.index+1}${use.step?`, ${use.step}`:''}`,onOpen:()=>actions.open(pathOf(campaign,'scenes',use.scene))}))} none="No scene's effect names it yet."/>
  </ItemCard>;
}

/** [+ Add quest]: its title, and a key that's a slug of it unless one's typed. */
function NewQuest({doc,actions}:{doc:ScenarioDocument;actions:ScenarioActions}){
  const [open,setOpen]=useState(false),[title,setTitle]=useState(''),[key,setKey]=useState('');
  const quests=doc.quests??{};
  const wanted=slugOf(key)||slugOf(title),final=key.trim()?slugOf(key):uniqueId(wanted,Object.keys(quests));
  const problem=final?questKeyProblem(doc,final):undefined;
  const close=()=>{setOpen(false);setTitle('');setKey('')};
  const add=()=>{if(!title.trim()||!final||problem)return;actions.edit(setScenarioField(doc,'quests',{...quests,[final]:title.trim()}));close()};
  if(!open)return <button type="button" className="add-item" onClick={()=>setOpen(true)}><Plus size={13}/>Add quest</button>;
  return <div className="add-picker new-quest" role="group" aria-label="Add a quest" data-own-escape onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}}}>
    <header><b>Add a quest</b><button type="button" className="icon-button" aria-label="Cancel" onClick={close}><X size={13}/></button></header>
    <input autoFocus aria-label="New quest's title" placeholder="Its title (The Heron Ledger)" value={title} onChange={event=>setTitle(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')add()}}/>
    <input aria-label="New quest's key" placeholder={`Its key (${final||'a-slug'})`} value={key} onChange={event=>setKey(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')add()}}/>
    <small className={problem?'json-problem':'field-hint'}>{problem??'The key is what the scenes\' effects name: a slug of the title unless you type one.'}</small>
    <button type="button" className="primary" disabled={!title.trim()||!final||!!problem} onClick={add}><Plus size={13}/>Add quest</button>
  </div>;
}
