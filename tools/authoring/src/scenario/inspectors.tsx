// The scenario editor's inspectors: the scenario's own fields (its start, the story's scenes and the
// maps and places it lists, the purse, the quests, the world a backstory is written for), and what's
// selected on the diagram, a card or a way out of one, each edited in the file that owns it.
import React,{useId,useState} from 'react';
import {ArrowDown,ArrowUp,ExternalLink,Plus,Trash2} from 'lucide-react';
import {ListField,NumberField,Section,SelectField,TextArea,TextField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {TIMES} from '../map/model.ts';
import type {Tile2} from '../map/model.ts';
import {TileFields} from '../map/inspectors.tsx';
import {moved,optionalText,slugOf,uniqueId,withKey} from '../campaign/json.ts';
import type {CampaignFiles} from '../campaign/files.ts';
import {ORDER,setCreationField,setScenarioField,setStartField,withStart} from './model.ts';
import type {ScenarioDocument} from './model.ts';

type Lists='scenes'|'maps'|'places';
export type ScenarioActions={
  /** The scenario changed (its own file). */
  edit:(next:ScenarioDocument)=>void;
  /** A new file of the campaign, made and listed: a scene, a map or a place, by its title. */
  create:(kind:Lists,title:string)=>void;
  /** Take something out of the scenario's lists, after asking (the file stays). */
  unlist:(kind:Lists,key:string)=>void;
  open:(path:string)=>void;
  landing:(map:string)=>Tile2;
};

/** The scenario's own fields. */
export function ScenarioPanel({doc,campaign,actions}:{doc:ScenarioDocument;campaign:CampaignFiles|null;actions:ScenarioActions}){
  const set=(key:string,value:unknown)=>actions.edit(setScenarioField(doc,key,value));
  const title=(kind:Lists,key:string)=>(kind==='scenes'?campaign?.scenes:kind==='maps'?campaign?.maps:campaign?.places)?.find(file=>file.key===key)?.doc?.title??key;
  const options=(kind:Lists,none?:string):Option[]=>[...(none?[{value:'',label:none}]:[]),...doc[kind].map(key=>({value:key,label:`${title(kind,key)} (${key})`}))];
  const lore=(campaign?.lore??[]).filter(path=>path.endsWith('.md'));
  const loreOptions=(none:string):Option[]=>[{value:'',label:none},...lore.map(path=>({value:path,label:path}))];
  return <div className="scenario-panel">
    <p className="inspector-kind"><span className="kind-dot scenario"/>Scenario<code title="The campaign's id: its file's name">{doc.id}</code></p>
    <Section title="The campaign" field="campaign">
      <TextField label="Title" field="title" value={doc.title} onChange={value=>set('title',value)}/>
      <TextArea label="Description" field="description" rows={3} value={doc.description} onChange={value=>set('description',value)}/>
      <div className="field-row">
        <TextField label="Campaign version" field="campaignVersion" hint="The campaign's own (installed as id@version)." value={doc.campaignVersion??''} onChange={value=>set('campaignVersion',value)}/>
        <NumberField label="Level" field="level" min={1} max={20} value={doc.level} onChange={value=>set('level',value)}/>
      </div>
      <TextField label="Rules pack" field="rulesPack" hint="The rules engine's content pack (starter-pack@0.1.0)." value={doc.rulesPack} onChange={value=>set('rulesPack',value)}/>
    </Section>
    <Section title="The start" field="start">
      <SelectField label="First scene" field="firstScene" hint="The story's first lead (or, with no start map, the scene it opens in)." value={doc.firstScene} options={options('scenes','None yet')} onChange={value=>set('firstScene',value)}/>
      <SelectField label="Start place" field="startPlace" hint="The place a scene with none of its own is played in." value={doc.startPlace} options={options('places','None yet')} onChange={value=>set('startPlace',value)}/>
      <div className="field-row">
        <NumberField label="Day" field="start.day" min={1} max={999} value={doc.start.day} onChange={value=>actions.edit(setStartField(doc,'day',value))}/>
        <SelectField label="Time" field="start.time" value={doc.start.time} options={TIMES.map(time=>({value:time,label:time.replace('-',' ')}))} onChange={value=>actions.edit(setStartField(doc,'time',value))}/>
      </div>
      <SelectField label="Start map" field="start.map" hint="Where the player starts walking; none, and the first scene opens at once." value={doc.start.map??''} options={options('maps','None: the first scene opens at once')} onChange={value=>actions.edit(withStart(doc,value||undefined,value?(value===doc.start.map&&doc.start.at?{x:doc.start.at[0],y:doc.start.at[1]}:actions.landing(value)):undefined))}/>
      {doc.start.map&&doc.start.at&&<TileFields label="Start tile" field="start.at" at={{x:doc.start.at[0],y:doc.start.at[1]}} onChange={at=>actions.edit(withStart(doc,doc.start.map,at))}/>}
      {doc.start.map&&<p className="field-hint">Or move the flag on the map itself.</p>}
    </Section>
    <FileList kind="scenes" title="Scenes" hint="The story's scenes, in order. An ending's next goes on to one; a region of a map plays one." doc={doc} campaign={campaign} actions={actions} ordered/>
    <Section title="Talk template" field="talk">
      <SelectField label="Talk template" field="talk" hint="A word with whoever walks with the player between scenes: never one of the story's scenes." value={doc.talk??''} options={[{value:'',label:'None'},...(campaign?.present.scenes??[]).filter(key=>!doc.scenes.includes(key)).map(key=>({value:key,label:key}))]} onChange={value=>set('talk',value||undefined)}/>
    </Section>
    <FileList kind="maps" title="Maps" hint="The maps walked between scenes (maps/<id>.kmmap)." doc={doc} campaign={campaign} actions={actions}/>
    <FileList kind="places" title="Places" hint="The scenes' places (places/<id>.kmplace)." doc={doc} campaign={campaign} actions={actions}/>
    <Purse doc={doc} edit={actions.edit}/>
    <Quests doc={doc} edit={actions.edit}/>
    <Section title="The world a backstory is written for" field="creation" open={false}>
      <TextField label="World" field="creation.name" value={doc.creation.name} onChange={value=>actions.edit(setCreationField(doc,'name',value))}/>
      <TextArea label="Premise" field="creation.premise" rows={6} hint="The story the backstory leads into: why they took this case, and that the story's people don't know them yet." value={doc.creation.premise} onChange={value=>actions.edit(setCreationField(doc,'premise',value))}/>
      <SelectField label="Primer" field="creation.primer" hint="The lore doc that tells of the world." value={doc.creation.primer} options={loreOptions('None')} onChange={value=>actions.edit(setCreationField(doc,'primer',value))}/>
      <ListField label="Not canon" field="creation.notCanon" rows={1} hint="World docs the lore check doesn't read (how the world stands now, its fronts, the index): lore paths." items={doc.creation.notCanon} onChange={items=>actions.edit(setCreationField(doc,'notCanon',items))}/>
      <CreationPlaces doc={doc} edit={actions.edit} lore={lore}/>
    </Section>
    {doc.layout&&<Section title="Layout" field="layout" open={false}><p className="muted">Where {Object.keys(doc.layout).length} cards sit on this diagram (the game doesn't read it).</p><button type="button" className="text-button" onClick={()=>set('layout',undefined)}>Forget the layout</button></Section>}
  </div>;
}

/** One of the scenario's lists: what it lists (in order, for scenes), what the folder has that it doesn't, and a new one. */
function FileList({kind,title,hint,doc,campaign,actions,ordered}:{kind:Lists;title:string;hint:string;doc:ScenarioDocument;campaign:CampaignFiles|null;actions:ScenarioActions;ordered?:boolean}){
  const [name,setName]=useState(''),id=useId();
  const files=kind==='scenes'?campaign?.scenes:kind==='maps'?campaign?.maps:campaign?.places;
  const present=campaign?.present[kind]??[];
  const unlisted=present.filter(key=>!doc[kind].includes(key)&&!(kind==='scenes'&&key===doc.talk));
  const folder=kind;
  return <Section title={title} field={kind} count={doc[kind].length}>
    <small className="field-hint">{hint}</small>
    <ol className="file-list">
      {doc[kind].map((key,index)=>{const file=files?.find(f=>f.key===key);return <li key={key} data-listed={key}>
        <button type="button" className="file-open" title={`Open ${folder}/${key}`} onClick={()=>file&&actions.open(file.path)}><b>{(file?.doc as {title?:string}|undefined)?.title??key}</b><small>{key}{file&&!file.text?' · no file':file?.error?' · can\'t be read':''}</small></button>
        {ordered&&<><button type="button" aria-label={`Move ${key} up`} disabled={index===0} onClick={()=>actions.edit(setScenarioField(doc,kind,moved(doc[kind],index,index-1)))}><ArrowUp size={12}/></button><button type="button" aria-label={`Move ${key} down`} disabled={index===doc[kind].length-1} onClick={()=>actions.edit(setScenarioField(doc,kind,moved(doc[kind],index,index+1)))}><ArrowDown size={12}/></button></>}
        <button type="button" aria-label={`Take ${key} out of the scenario`} title="Take it out of the scenario (the file stays)" onClick={()=>actions.unlist(kind,key)}><Trash2 size={12}/></button>
      </li>})}
    </ol>
    {unlisted.length>0&&<SelectField label={`List one of ${folder}/`} field={`${kind}.add`} value="" options={[{value:'',label:'Choose…'},...unlisted.map(key=>({value:key,label:key}))]} onChange={value=>{if(value)actions.edit(setScenarioField(doc,kind,[...doc[kind],value]))}}/>}
    <div className="new-file"><label className="field-label" htmlFor={id}>{`New ${kind==='scenes'?'scene':kind==='maps'?'map':'place'}`}</label><div className="new-file-row"><input id={id} value={name} placeholder="Its title" onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&slugOf(name)){actions.create(kind,name.trim());setName('')}}}/><button type="button" disabled={!slugOf(name)} onClick={()=>{actions.create(kind,name.trim());setName('')}}><Plus size={13}/>Create</button></div><small className="field-hint">{slugOf(name)?`${folder}/${slugOf(name)}.${kind==='scenes'?'kmscene':kind==='maps'?'kmmap':'kmplace'}, listed here`:'Its file is named for the slug of its title, which is its id.'}</small></div>
  </Section>;
}

function Purse({doc,edit}:{doc:ScenarioDocument;edit:(next:ScenarioDocument)=>void}){
  const purse=doc.startingPurse;
  const setCoin=(index:number,key:string,value:unknown)=>edit(setScenarioField(doc,'startingPurse',purse.map((coin,i)=>i===index?withKey(coin,key,value,ORDER.coin):coin)));
  return <Section title="Starting purse" field="startingPurse" count={purse.length} open={false}>
    {purse.map((coin,index)=><div className="purse-row" key={index}>
      <div className="field-row">
        <TextField label="Coin" value={coin.name} onChange={value=>setCoin(index,'name',value)}/>
        <NumberField label="How many" min={0} max={99999} value={coin.quantity} onChange={value=>setCoin(index,'quantity',value)}/>
        <button type="button" aria-label={`Remove ${coin.name||'the coin'}`} onClick={()=>edit(setScenarioField(doc,'startingPurse',purse.filter((_,i)=>i!==index)))}><Trash2 size={13}/></button>
      </div>
      <TextField label="Coin description" value={coin.description} onChange={value=>setCoin(index,'description',value)}/>
    </div>)}
    <button type="button" className="add-item" onClick={()=>edit(setScenarioField(doc,'startingPurse',[...purse,{name:'',quantity:1,description:''}]))}><Plus size={13}/>Add a coin</button>
  </Section>;
}

function Quests({doc,edit}:{doc:ScenarioDocument;edit:(next:ScenarioDocument)=>void}){
  const quests=doc.quests??{};
  const [name,setName]=useState('');
  const add=()=>{const key=uniqueId(slugOf(name),Object.keys(quests));edit(setScenarioField(doc,'quests',{...quests,[key]:name.trim()}));setName('')};
  return <Section title="Quests" field="quests" count={Object.keys(quests).length} open={false}>
    <small className="field-hint">A quest's key is what the scenes' effects name: it's made once from its title and stays.</small>
    {Object.entries(quests).map(([key,title])=><div className="field-row quest-row" key={key}>
      <TextField label={`Quest ${key}`} value={title} onChange={value=>edit(setScenarioField(doc,'quests',{...quests,[key]:value}))}/>
      <button type="button" aria-label={`Remove the quest ${key}`} onClick={()=>edit(setScenarioField(doc,'quests',Object.fromEntries(Object.entries(quests).filter(([k])=>k!==key))))}><Trash2 size={13}/></button>
    </div>)}
    <div className="new-file-row"><input aria-label="New quest's title" value={name} placeholder="The Heron Ledger" onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&slugOf(name))add()}}/><button type="button" disabled={!slugOf(name)} onClick={add}><Plus size={13}/>Add quest</button></div>
  </Section>;
}

function CreationPlaces({doc,edit,lore}:{doc:ScenarioDocument;edit:(next:ScenarioDocument)=>void;lore:string[]}){
  const places=doc.creation.places;
  const set=(index:number,key:string,value:string)=>edit(setCreationField(doc,'places',places.map((place,i)=>i===index?withKey(place,key,value,ORDER.creationPlace):place)));
  return <fieldset className="creation-places" data-field="creation.places">
    <legend className="field-label">Places a backstory can call up</legend>
    {places.map((place,index)=><div className="field-row" key={index}>
      <SelectField label={`Place doc ${index+1}`} value={place.doc} options={lore.map(path=>({value:path,label:path}))} onChange={value=>set(index,'doc',value)}/>
      <TextField label={`Words ${index+1}`} value={place.words} onChange={value=>set(index,'words',value)}/>
      <button type="button" aria-label={`Remove place doc ${index+1}`} onClick={()=>edit(setCreationField(doc,'places',places.filter((_,i)=>i!==index)))}><Trash2 size={13}/></button>
    </div>)}
    <button type="button" className="add-item" onClick={()=>edit(setCreationField(doc,'places',[...places,{doc:lore.find(path=>path.startsWith('Places/'))??'',words:''}]))}><Plus size={13}/>Add a place doc</button>
    <small className="field-hint">A doc of the lore and the words that call it up (a regular expression, read without case).</small>
  </fieldset>;
}

export {optionalText,ExternalLink};
