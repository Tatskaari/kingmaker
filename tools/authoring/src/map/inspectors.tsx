// The map editor's forms: a legend entry (the painter's palette), a region, an exit, someone about on
// the map, a tile and what's on it. Each edits one value and hands on the whole map. They're the
// inspector's (what's selected on the painter) and the cards of the map's views (Legend, Regions,
// Exits, People) alike.
import React,{useContext,useEffect,useId,useState} from 'react';
import {Brush,ExternalLink,Flag,MapPin,Trash2} from 'lucide-react';
import {Checkbox,Checklist,EditSession,IdField,NumberField,OptionalSection,SelectField,TextArea,TextField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {ACTOR_KINDS,ORDER,TERRAINS,TIMES,VOID,cellAt,entryName,legendCharProblem,movedPoint,setExit,setPersonField,setRegionField,thingsAt} from './model.ts';
import type {Cells,DecorDef,LegendEntry,MapDocument,MapExit,MapPerson,Tile2} from './model.ts';
import {BLOCKS,GROUND} from '../../../../client/map/palette.ts';
import {optionalList,optionalText,withKey} from '../campaign/json.ts';
import {NewFile,Uses,WordChips} from '../campaign/views.tsx';
import {swatchOf} from './look.ts';

/** A whole number that may be left out: empty is no value at all. */
export function OptionalNumber({label,hint,field,value,onChange,min=0,max=99,placeholder='—'}:{label:string;hint?:string;field?:string;value:number|undefined;onChange:(value:number|undefined)=>void;min?:number;max?:number;placeholder?:string}){
  const session=useContext(EditSession),id=useId(),hintId=useId();
  const [text,setText]=useState(value===undefined?'':String(value));
  useEffect(()=>{if((text.trim()===''?undefined:Number(text))!==value)setText(value===undefined?'':String(value))},[value]);
  return <div className="field" data-field={field}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <input {...session} id={id} type="number" min={min} max={max} aria-describedby={hint?hintId:undefined} value={text} placeholder={placeholder} onChange={event=>{
      setText(event.target.value);
      const raw=event.target.value.trim(),next=Number(raw);
      if(raw==='')onChange(undefined);else if(Number.isInteger(next))onChange(next);
    }}/>
    {hint&&<small id={hintId} className="field-hint">{hint}</small>}
  </div>;
}

/** A tile: its x and y. */
export function TileFields({label,at,onChange,field}:{label:string;at:Tile2;onChange:(at:Tile2)=>void;field?:string}){
  return <fieldset className="tile-field" data-field={field}>
    <legend className="field-label">{label}</legend>
    <div className="field-row">
      <NumberField label="x" min={0} max={159} value={at.x} onChange={x=>onChange(movedPoint(at,{x,y:at.y}))}/>
      <NumberField label="y" min={0} max={119} value={at.y} onChange={y=>onChange(movedPoint(at,{x:at.x,y}))}/>
    </div>
  </fieldset>;
}

const STYLES=[...new Set([...Object.keys(BLOCKS),...Object.keys(GROUND)])].filter(style=>style!=='void').sort();
const tri=(value:boolean|undefined)=>value===undefined?'':value?'yes':'no';
const fromTri=(value:string)=>value===''?undefined:value==='yes';
const TRI:Option[]=[{value:'',label:'As its terrain'},{value:'yes',label:'Yes'},{value:'no',label:'No'}];

/** A legend entry's fields: its terrain and how it overrides it, and the decor that stands on it. */
export function LegendEntryForm({entry,onChange}:{entry:LegendEntry;onChange:(entry:LegendEntry)=>void}){
  const styles=useId();
  const set=(key:string,value:unknown)=>onChange(withKey(entry,key,value,ORDER.legend));
  const decor=entry.decor;
  const setDecor=(key:string,value:unknown)=>set('decor',withKey(decor??{name:'',glyph:''},key,value,ORDER.decor) as DecorDef);
  return <div className="legend-form">
    <datalist id={styles}>{STYLES.map(style=><option key={style} value={style}/>)}</datalist>
    <SelectField label="Terrain" field="terrain" hint="What the tile is: how it's walked, seen through and drawn." value={entry.terrain} options={TERRAINS.map(t=>({value:t,label:t}))} onChange={value=>set('terrain',value)}/>
    <TextField label="Style" field="style" hint="The renderer's look: stone, brick, timber, palace, carpet…" list={styles} value={entry.style??''} onChange={value=>set('style',optionalText(value))}/>
    <div className="field-row">
      <OptionalNumber label="Height" field="height" hint="Raised: walls 3 unless said." value={entry.height} onChange={value=>set('height',value)}/>
      <SelectField label="Blocks" field="blocks" value={tri(entry.blocks)} options={TRI} onChange={value=>set('blocks',fromTri(value))}/>
      <SelectField label="Opaque" field="opaque" value={tri(entry.opaque)} options={TRI} onChange={value=>set('opaque',fromTri(value))}/>
    </div>
    <div className="field-row">
      <TextField label="Roof" field="roof" hint="A floor under a roof: the roof's look from outside." list={styles} value={entry.roof??''} onChange={value=>set('roof',optionalText(value))}/>
      <OptionalNumber label="Roof height" field="roofHeight" value={entry.roofHeight} onChange={value=>set('roofHeight',value)}/>
    </div>
    <OptionalSection title="Decor" field="decor" present={!!decor} addLabel="Something stands on it" hint="Decor: a lamp post, a stall, a sign. It becomes something on the map to look at." onAdd={()=>set('decor',{name:'',glyph:'?'})} onRemove={()=>set('decor',undefined)}>
      {decor&&<>
        <TextField label="Decor name" field="decor.name" value={decor.name} onChange={value=>setDecor('name',value)}/>
        <div className="field-row">
          <TextField label="Glyph" field="decor.glyph" value={decor.glyph} onChange={value=>setDecor('glyph',value)}/>
          <ColourField label="Colour" value={decor.color} onChange={value=>setDecor('color',value)}/>
          <SelectField label="Decor kind" field="decor.kind" value={decor.kind??''} options={[{value:'',label:'An object'},...ACTOR_KINDS.map(k=>({value:k,label:k}))]} onChange={value=>setDecor('kind',value||undefined)}/>
        </div>
        <WordChips label="Decor states" field="decor.states" addLabel="Add a state" placeholder="lit" hint="Worth drawing: overhead (drawn high, never in the way), lamp, lit, post…" words={decor.states??[]} onChange={words=>setDecor('states',optionalList(words))}/>
        <TextArea label="Decor text" field="decor.text" rows={2} hint="What it is when it's looked at." value={decor.text??''} onChange={value=>setDecor('text',optionalText(value))}/>
        <Checkbox label="Decor blocks the way" field="decor.blocks" checked={!!decor.blocks} onChange={checked=>setDecor('blocks',checked?true:undefined)}/>
        <TextField label="Decor id" field="decor.id" hint="A stable id for one of a kind (the price board); otherwise one is made from its tile." value={decor.id??''} onChange={value=>setDecor('id',optionalText(value))}/>
      </>}
    </OptionalSection>
  </div>;
}

/** A colour: the picker and its hex, or none. */
export function ColourField({label,value,onChange}:{label:string;value:string|undefined;onChange:(value:string|undefined)=>void}){
  const session=useContext(EditSession),id=useId();
  return <div className="field colour-field">
    <label className="field-label" htmlFor={id}>{label}</label>
    <div className="colour-inputs">
      <input {...session} type="color" aria-label={`${label} picker`} value={/^#[0-9a-f]{6}$/i.test(value??'')?value:'#d8d0c0'} onChange={event=>onChange(event.target.value)}/>
      <input {...session} id={id} value={value??''} placeholder="none" onChange={event=>onChange(optionalText(event.target.value))}/>
    </div>
  </div>;
}

/** A legend entry: its character (renamed, the grid following), swatch and name, its fields, and how much of the map it is. */
export function LegendInspector({doc,ch,entry,uses,onChange,onRename,onRemove,onPaint}:{doc:MapDocument;ch:string;entry:LegendEntry;uses:number;onChange:(entry:LegendEntry)=>void;onRename:(to:string)=>void;onRemove:()=>void;onPaint:()=>void}){
  return <div className="legend-inspector" data-legend={ch}>
    <p className="inspector-kind"><span className="legend-swatch" style={{background:swatchOf(entry)}}/>Legend entry<code title="The character the grid is written in">{ch}</code></p>
    <h3 className="inspector-title">{entryName(entry)}</h3>
    <p className="muted">{uses} tile{uses===1?'':'s'} of the map.</p>
    <IdField id={ch} label="Character" field="char" problem={next=>legendCharProblem(doc,next)} onRename={onRename}
      warning={`Every tile painted with it is written in the new character${uses?` (${uses} tile${uses===1?'':'s'})`:''}: one you can see, not in the legend yet.`}/>
    <LegendEntryForm entry={entry} onChange={onChange}/>
    <div className="inspector-actions">
      <button type="button" onClick={onPaint}><Brush size={14}/>Paint with it</button>
      <button type="button" className="danger" onClick={onRemove}><Trash2 size={14}/>Delete entry…</button>
    </div>
  </div>;
}

/** What a region's form needs of its editor besides the map: the scenario's scenes and maps, and the files a new scene or place is made in. */
export type RegionContext={
  scenes:Option[];maps:Option[];
  /** The scenes' and maps' files the campaign folder has (a new one's name must be free). */
  taken:{scenes:string[];maps:string[];places:string[]};
  /** A new scene made and listed, and played here: one step. */
  newScene:(index:number,title:string,id:string)=>void;
  /** The place of a scene (in the scene's file), set to one of the scenario's or a new one made and listed. */
  places:Option[];
  placeOf:(scene:string)=>{key?:string;path?:string;title?:string;size?:{w:number;h:number};error?:string;reading?:boolean};
  setPlace:(scene:string,place:string|undefined)=>void;
  newPlace:(scene:string,title:string,id:string)=>void;
  open:(path:string)=>void;
};

/** A region: its name and where it is, the scene it plays and how (its place laid here, or opened), and what the player is told at it. */
export function RegionInspector({doc,index,context,onChange,onRemove,onShowPlace,placeNote,shown,onRename}:{doc:MapDocument;index:number;context:RegionContext;onChange:(next:MapDocument)=>void;onRemove:()=>void;onShowPlace?:()=>void;placeNote?:string;shown?:boolean;onRename?:(to:string)=>void}){
  const region=doc.regions[index];
  if(!region)return <p className="muted">That region isn't on the map any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setRegionField(doc,index,key,value));
  const unset=(...keys:string[])=>onChange(keys.reduce((next,key)=>setRegionField(next,index,key,undefined),doc));
  const rect=region.rect;
  const setRect=(key:'x'|'y'|'w'|'h',value:number)=>set('rect',withKey(rect,key,value,ORDER.rect));
  const none={value:'',label:'None'};
  const place=region.sceneId?context.placeOf(region.sceneId):undefined;
  return <div className="region-inspector" data-region={region.id}>
    <p className="inspector-kind"><span className="kind-dot region"/>Region<code title="Its id: unique across the campaign's maps; game state keys on it">{region.id}</code></p>
    <TextField label="Name" field="name" value={region.name} onChange={value=>set('name',value)}/>
    {onRename&&<IdField id={region.id} label="Region id" problem={next=>/^[a-z0-9][a-z0-9-]*$/.test(next)?undefined:'An id is a slug: lower-case letters, digits and dashes.'} onRename={onRename}
      warning="Unique across the campaign's maps (the problems say if it isn't). Game state keys on it, and the town's code names a few of Caerwyn's: a game already played loses track of it under the old id."/>}
    <fieldset className="rect-field" data-field="rect"><legend className="field-label">Where (tiles)</legend><div className="field-row">
      <NumberField label="x" min={0} max={159} value={rect.x} onChange={value=>setRect('x',value)}/>
      <NumberField label="y" min={0} max={119} value={rect.y} onChange={value=>setRect('y',value)}/>
      <NumberField label="w" min={1} max={160} value={rect.w} onChange={value=>setRect('w',value)}/>
      <NumberField label="h" min={1} max={120} value={rect.h} onChange={value=>setRect('h',value)}/>
    </div></fieldset>
    <OptionalSection title="Plays a scene" field="sceneId" present={region.sceneId!==undefined} addLabel="Play a scene here" hint="A region that plays a scene lays its place here, or opens it (its place laid by another region)." onRemove={()=>unset('sceneId','worldOrigin','trigger','label')}>
      <SelectField label="Scene" field="sceneId" hint="The scene played here: one of the scenario's." value={region.sceneId??''} placeholder="Choose a scene…" options={context.scenes} onChange={value=>set('sceneId',value||undefined)}/>
      <NewFile kind="scene" label="New scene, played here" taken={context.taken.scenes} onCreate={(title,id)=>context.newScene(index,title,id)}/>
      {region.sceneId!==undefined&&<>
        <Checkbox label="Its scene's place is laid here" field="worldOrigin" hint="Where the scene's world (0, 0) sits on the map: its place, five feet to a tile." checked={!!region.worldOrigin} onChange={checked=>set('worldOrigin',checked?{x:rect.x,y:rect.y}:undefined)}/>
        {region.worldOrigin&&<TileFields label="Place origin (tile)" field="worldOrigin.at" at={region.worldOrigin} onChange={at=>set('worldOrigin',at)}/>}
        {region.worldOrigin&&place&&<ScenePlace scene={region.sceneId} place={place} context={context}/>}
        {onShowPlace&&<button type="button" className="wide-button" aria-pressed={shown} onClick={onShowPlace}><MapPin size={14}/>{shown?'Hide its place':'Show its place on the map'}</button>}
        {placeNote&&<p className="muted">{placeNote}</p>}
        <SelectField label="Trigger" field="trigger" hint="How the scene opens when it's the lead: stepping in, or talking to someone in it." value={region.trigger??''} options={[none,{value:'enter',label:'Enter'},{value:'interact',label:'Interact'}]} onChange={value=>set('trigger',value||undefined)}/>
        <TextField label="Label" field="label" hint="What the trigger says (“Step down into the Drowned Rat”)." value={region.label??''} onChange={value=>set('label',optionalText(value))}/>
      </>}
    </OptionalSection>
    <OptionalSection title="Shut outside its scene's time" field="shut" present={region.shut!==undefined||region.opensFor!==undefined} addLabel="Shut outside its scene's time" onRemove={()=>unset('shut','opensFor')}>
      <TextArea label="Shut" field="shut" rows={2} hint="What the player is told at the door when it's shut." value={region.shut??''} onChange={value=>set('shut',optionalText(value))}/>
      <SelectField label="Opens for" field="opensFor" hint="The scene whose time opens it (its own scene unless said)." value={region.opensFor??''} options={[none,...context.scenes]} onChange={value=>set('opensFor',value||undefined)}/>
    </OptionalSection>
    <OptionalSection title="Locked after its scene" field="lockedAfter" present={region.lockedAfter!==undefined} addLabel="Locked after its scene" onRemove={()=>unset('lockedAfter')}>
      <TextArea label="Locked after" field="lockedAfter" rows={2} hint="Locked up once its scene has been played (you can still get out): what the player is told." value={region.lockedAfter??''} onChange={value=>set('lockedAfter',optionalText(value))}/>
    </OptionalSection>
    <OptionalSection title="The outside of a scene's place" field="exteriorOf" present={region.exteriorOf!==undefined} addLabel="The outside of a scene's place" onRemove={()=>unset('exteriorOf')}>
      <SelectField label="Exterior of" field="exteriorOf" hint="The outside of a scene's place on another map (the Heron seen from the town): it shows what the scene did to it." value={region.exteriorOf??''} placeholder="Choose a scene…" options={context.scenes} onChange={value=>set('exteriorOf',value||undefined)}/>
    </OptionalSection>
    <OptionalSection title="Its locked doors" field="locked" present={region.locked!==undefined} addLabel="What its locked doors say" onRemove={()=>unset('locked')}>
      <TextField label="Locked" field="locked" hint="What its locked doors say when they're tried." value={region.locked??''} onChange={value=>set('locked',optionalText(value))}/>
    </OptionalSection>
    <TextArea label="Description" field="description" rows={3} hint="What it is, for the GM and the map's hover." value={region.description??''} onChange={value=>set('description',optionalText(value))}/>
    <div className="inspector-actions"><button type="button" className="danger" onClick={onRemove}><Trash2 size={14}/>Delete region…</button></div>
  </div>;
}

/** The place a region lays: its scene's place (in the scene's file), opened, or chosen or made when the scene hasn't one. */
function ScenePlace({scene,place,context}:{scene:string;place:ReturnType<RegionContext['placeOf']>;context:RegionContext}){
  if(place.key&&place.title)return <Uses title="Its place" field="place" uses={[{key:place.key,label:place.title,detail:`${place.path}${place.size?` · ${place.size.w} × ${place.size.h} feet = ${Math.ceil(place.size.w/5)} × ${Math.ceil(place.size.h/5)} tiles`:''}`,onOpen:()=>context.open(place.path!)}]} none=""/>;
  if(place.reading)return <p className="muted" data-field="place">{place.error}</p>;
  return <div className="scene-place" data-field="place">
    {place.error&&<p className="muted">{place.error}</p>}
    <SelectField label={`${scene}'s place`} field="place" hint="Where the scene is played: set in the scene's file." value={place.key??''} placeholder="Choose a place…" options={context.places} onChange={value=>context.setPlace(scene,value||undefined)}/>
    <NewFile kind="place" label="New place for it" taken={context.taken.places} onCreate={(title,id)=>context.newPlace(scene,title,id)}/>
  </div>;
}

/** A way to another map: its tile here, where it lands there, and what it says. */
export function ExitInspector({doc,index,maps,taken,onChange,onRemove,onOpen,onNewMap}:{doc:MapDocument;index:number;maps:Option[];taken:string[];onChange:(next:MapDocument)=>void;onRemove:()=>void;onOpen:(map:string)=>void;onNewMap:(index:number,title:string,id:string)=>void}){
  const exit=doc.exits[index];
  if(!exit)return <p className="muted">That exit isn't on the map any more.</p>;
  const set=(next:MapExit)=>onChange(setExit(doc,index,next));
  return <div className="exit-inspector" data-exit={index}>
    <p className="inspector-kind"><span className="kind-dot exit"/>Exit<code>{exit.at.x}, {exit.at.y}</code></p>
    <TextField label="Label" field="label" hint="What the way says (“The Drowned Rat's door”)." value={exit.label} onChange={label=>set({...exit,label})}/>
    <TileFields label="From (tile here)" field="at" at={exit.at} onChange={at=>set({...exit,at})}/>
    <SelectField label="To map" field="to.map" hint="One of the scenario's maps." value={exit.to.map} options={maps} onChange={map=>set({...exit,to:{...exit.to,map}})}/>
    <NewFile kind="map" label="New map, where it leads" taken={taken} onCreate={(title,id)=>onNewMap(index,title,id)}/>
    <TileFields label="Lands at (tile there)" field="to.at" at={exit.to.at} onChange={at=>set({...exit,to:{...exit.to,at}})}/>
    <button type="button" className="text-button" onClick={()=>onOpen(exit.to.map)}>Open {exit.to.map} <ExternalLink size={11}/></button>
    <div className="inspector-actions"><button type="button" className="danger" onClick={onRemove}><Trash2 size={14}/>Delete exit…</button></div>
  </div>;
}

const TIME_OPTIONS:Option[]=TIMES.map(time=>({value:time,label:time.replace('-',' ')}));

/** Someone about on the map at some hours: who they are, how they look, where they stand, what they say. */
export function PersonInspector({doc,index,onChange,onRemove}:{doc:MapDocument;index:number;onChange:(next:MapDocument)=>void;onRemove:()=>void}){
  const person=(doc.people??[])[index] as MapPerson|undefined;
  if(!person)return <p className="muted">They aren't on the map any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setPersonField(doc,index,key,value));
  return <div className="person-inspector" data-person={index}>
    <p className="inspector-kind"><span className="person-glyph" style={{color:person.color??'#b8ad9c'}}>{person.glyph}</span>Someone about<code>{person.at.x}, {person.at.y}</code></p>
    <TextField label="Name" field="name" value={person.name} onChange={value=>set('name',value)}/>
    <div className="field-row">
      <TextField label="Glyph" field="glyph" value={person.glyph} onChange={value=>set('glyph',value)}/>
      <ColourField label="Colour" value={person.color} onChange={value=>set('color',value)}/>
      <SelectField label="Kind" field="kind" value={person.kind??''} options={[{value:'',label:'A person'},...ACTOR_KINDS.filter(k=>k!=='person').map(k=>({value:k,label:k}))]} onChange={value=>set('kind',value||undefined)}/>
    </div>
    <TileFields label="Stands at (tile)" field="at" at={person.at} onChange={at=>set('at',at)}/>
    <Checklist label="Times" field="times" hint="The hours they're about." options={TIME_OPTIONS} selected={person.times} onChange={times=>set('times',times)}/>
    <TextArea label="Text" field="text" rows={3} hint="What they say when they're talked to, or what it is when it's looked at." value={person.text} onChange={value=>set('text',value)}/>
    <WordChips label="States" field="states" addLabel="Add a state" placeholder="asleep" words={person.states??[]} onChange={words=>set('states',optionalList(words))}/>
    <Checkbox label="Out of the way" field="blocks" hint="In the way unless this is ticked (a cat underfoot isn't)." checked={person.blocks===false} onChange={checked=>set('blocks',checked?false:undefined)}/>
    <div className="inspector-actions"><button type="button" className="danger" onClick={onRemove}><Trash2 size={14}/>Delete…</button></div>
  </div>;
}

/** What a tile is and what's on it, each to select, and what can be added there. */
export type TileAction={label:string;run:()=>void};
export function TileInspector({doc,cells,at,onSelect,onPaint,onEditEntry,actions,placeParts,start}:{doc:MapDocument;cells:Cells;at:Tile2;onSelect:(selection:{kind:'region'|'exit'|'person';index:number})=>void;onPaint:(ch:string)=>void;onEditEntry:(ch:string)=>void;actions:TileAction[];placeParts:Array<{label:string;detail:string;run:()=>void}>;start:boolean}){
  const ch=cellAt(cells,at),entry=doc.legend[ch],here=thingsAt(doc,at);
  const items=[
    ...here.regions.map(({region,index})=>({key:`region:${index}`,label:region.name||region.id,detail:`region${region.sceneId?` · plays ${region.sceneId}`:''}`,run:()=>onSelect({kind:'region',index})})),
    ...here.exits.map(({exit,index})=>({key:`exit:${index}`,label:exit.label,detail:`exit → ${exit.to.map}`,run:()=>onSelect({kind:'exit',index})})),
    ...here.people.map(({person,index})=>({key:`person:${index}`,label:person.name,detail:`about ${person.times.length===TIMES.length?'all day':person.times.join(', ')}`,run:()=>onSelect({kind:'person',index})})),
    ...placeParts.map((part,i)=>({key:`place:${i}`,label:part.label,detail:part.detail,run:part.run})),
  ];
  return <div className="tile-inspector" data-tile={`${at.x},${at.y}`}>
    <p className="inspector-kind"><span className="legend-swatch" style={{background:swatchOf(entry)}}/>Tile<code>{at.x}, {at.y}</code></p>
    <h3 className="inspector-title">{ch===VOID?'The void (no tile)':entryName(entry)}</h3>
    {ch!==VOID&&<p className="muted">Painted with “{ch}”. <button type="button" className="text-button" onClick={()=>onEditEntry(ch)}>Edit the entry</button> · <button type="button" className="text-button" onClick={()=>onPaint(ch)}>Paint with it</button></p>}
    {start&&<p className="muted"><Flag size={12}/> The story starts here.</p>}
    <span className="field-label">On this tile</span>
    {!items.length&&<p className="muted">Nothing but the ground.</p>}
    {items.length>0&&<ul className="tile-here">{items.map(item=><li key={item.key}><button type="button" onClick={item.run}><b>{item.label}</b><small>{item.detail}</small></button></li>)}</ul>}
    <span className="field-label">Add here</span>
    <div className="tile-actions">{actions.map(action=><button type="button" key={action.label} onClick={action.run}>{action.label}</button>)}</div>
  </div>;
}

export {TIME_OPTIONS};
