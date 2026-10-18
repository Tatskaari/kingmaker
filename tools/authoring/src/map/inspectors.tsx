// The map editor's inspectors: a legend entry (the painter's palette), a region, an exit, someone about
// on the map, the story's start, and the map itself. Each edits one value and hands on the whole map.
import React,{useContext,useEffect,useId,useState} from 'react';
import {ExternalLink,MapPin,Trash2} from 'lucide-react';
import {Checkbox,Checklist,EditSession,ListField,NumberField,SelectField,TextArea,TextField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {ACTOR_KINDS,ORDER,TERRAINS,TIMES,entryName,movedPoint,setExit,setPersonField,setRegionField} from './model.ts';
import type {DecorDef,LegendEntry,MapDocument,MapExit,MapPerson,PlaceRegion,Tile2} from './model.ts';
import {BLOCKS,GROUND} from '../../../../client/map/palette.ts';
import {optionalList,optionalText,withKey} from '../campaign/json.ts';
import {swatchOf} from './look.ts';

/** A whole number that may be left out: empty is no value at all. */
export function OptionalNumber({label,hint,field,value,onChange,min=0,max=99}:{label:string;hint?:string;field?:string;value:number|undefined;onChange:(value:number|undefined)=>void;min?:number;max?:number}){
  const session=useContext(EditSession),id=useId(),hintId=useId();
  const [text,setText]=useState(value===undefined?'':String(value));
  useEffect(()=>{if((text.trim()===''?undefined:Number(text))!==value)setText(value===undefined?'':String(value))},[value]);
  return <div className="field" data-field={field}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <input {...session} id={id} type="number" min={min} max={max} aria-describedby={hint?hintId:undefined} value={text} placeholder="—" onChange={event=>{
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
      <SelectField label="Blocks" field="blocks" value={tri(entry.blocks)} options={[{value:'',label:'As its terrain'},{value:'yes',label:'Yes'},{value:'no',label:'No'}]} onChange={value=>set('blocks',fromTri(value))}/>
      <SelectField label="Opaque" field="opaque" value={tri(entry.opaque)} options={[{value:'',label:'As its terrain'},{value:'yes',label:'Yes'},{value:'no',label:'No'}]} onChange={value=>set('opaque',fromTri(value))}/>
    </div>
    <div className="field-row">
      <TextField label="Roof" field="roof" hint="A floor under a roof: the roof's look from outside." list={styles} value={entry.roof??''} onChange={value=>set('roof',optionalText(value))}/>
      <OptionalNumber label="Roof height" field="roofHeight" value={entry.roofHeight} onChange={value=>set('roofHeight',value)}/>
    </div>
    <Checkbox label="Something stands on it" field="decor" hint="Decor: a lamp post, a stall, a sign. It becomes something on the map to look at." checked={!!decor} onChange={checked=>set('decor',checked?{name:'',glyph:'?'}:undefined)}/>
    {decor&&<fieldset className="decor-fields" data-field="decor">
      <legend className="field-label">Decor</legend>
      <TextField label="Decor name" field="decor.name" value={decor.name} onChange={value=>setDecor('name',value)}/>
      <div className="field-row">
        <TextField label="Glyph" field="decor.glyph" value={decor.glyph} onChange={value=>setDecor('glyph',value)}/>
        <ColourField label="Colour" value={decor.color} onChange={value=>setDecor('color',value)}/>
        <SelectField label="Decor kind" field="decor.kind" value={decor.kind??''} options={[{value:'',label:'An object'},...ACTOR_KINDS.map(k=>({value:k,label:k}))]} onChange={value=>setDecor('kind',value||undefined)}/>
      </div>
      <ListField label="Decor states" field="decor.states" rows={1} hint="Worth drawing: overhead (drawn high, never in the way), lamp, lit, post…" items={decor.states??[]} onChange={items=>setDecor('states',optionalList(items))}/>
      <TextArea label="Decor text" field="decor.text" rows={2} hint="What it is when it's looked at." value={decor.text??''} onChange={value=>setDecor('text',optionalText(value))}/>
      <Checkbox label="Decor blocks the way" field="decor.blocks" checked={!!decor.blocks} onChange={checked=>setDecor('blocks',checked?true:undefined)}/>
      <TextField label="Decor id" field="decor.id" hint="A stable id for one of a kind (the price board); otherwise one is made from its tile." value={decor.id??''} onChange={value=>setDecor('id',optionalText(value))}/>
    </fieldset>}
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

/** A legend entry, as the inspector shows it: its character, swatch and name, its fields, and how much of the map it is. */
export function LegendInspector({ch,entry,uses,onChange,onRemove,onPaint}:{ch:string;entry:LegendEntry;uses:number;onChange:(entry:LegendEntry)=>void;onRemove:()=>void;onPaint:()=>void}){
  return <div className="legend-inspector" data-legend={ch}>
    <p className="inspector-kind"><span className="legend-swatch" style={{background:swatchOf(entry)}}/>Legend entry<code title="The character the grid is written in">{ch}</code></p>
    <h3 className="inspector-title">{entryName(entry)}</h3>
    <p className="muted">{uses} tile{uses===1?'':'s'} of the map.</p>
    <LegendEntryForm entry={entry} onChange={onChange}/>
    <div className="inspector-actions">
      <button type="button" onClick={onPaint}>Paint with it</button>
      <button type="button" className="danger" onClick={onRemove}><Trash2 size={14}/>Delete entry…</button>
    </div>
  </div>;
}

type Choices={scenes:Option[];maps:Option[]};

/** A region: its name and where it is, the scene it plays and how, and what the player is told at it. */
export function RegionInspector({doc,index,choices,onChange,onRemove,onShowPlace,placeNote,shown}:{doc:MapDocument;index:number;choices:Choices;onChange:(next:MapDocument)=>void;onRemove:()=>void;onShowPlace?:()=>void;placeNote?:string;shown?:boolean}){
  const region=doc.regions[index];
  if(!region)return <p className="muted">That region isn't on the map any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setRegionField(doc,index,key,value));
  const rect=region.rect;
  const setRect=(key:'x'|'y'|'w'|'h',value:number)=>set('rect',withKey(rect,key,value,ORDER.rect));
  const none={value:'',label:'None'};
  return <div className="region-inspector" data-region={region.id}>
    <p className="inspector-kind"><span className="kind-dot region"/>Region<code title="Its id: unique across the campaign's maps; game state keys on it">{region.id}</code></p>
    <TextField label="Name" field="name" value={region.name} onChange={value=>set('name',value)}/>
    <fieldset className="rect-field" data-field="rect"><legend className="field-label">Where (tiles)</legend><div className="field-row">
      <NumberField label="x" min={0} max={159} value={rect.x} onChange={value=>setRect('x',value)}/>
      <NumberField label="y" min={0} max={119} value={rect.y} onChange={value=>setRect('y',value)}/>
      <NumberField label="w" min={1} max={160} value={rect.w} onChange={value=>setRect('w',value)}/>
      <NumberField label="h" min={1} max={120} value={rect.h} onChange={value=>setRect('h',value)}/>
    </div></fieldset>
    <SelectField label="Scene" field="sceneId" hint="The scene played here: one of the scenario's." value={region.sceneId??''} options={[none,...choices.scenes]} onChange={value=>set('sceneId',value||undefined)}/>
    {region.sceneId!==undefined&&<>
      <Checkbox label="Its scene's place is laid here" field="worldOrigin" hint="Where the scene's world (0, 0) sits on the map: its place, five feet to a tile." checked={!!region.worldOrigin} onChange={checked=>set('worldOrigin',checked?{x:rect.x,y:rect.y}:undefined)}/>
      {region.worldOrigin&&<TileFields label="Place origin (tile)" field="worldOrigin.at" at={region.worldOrigin} onChange={at=>set('worldOrigin',at)}/>}
      {onShowPlace&&<button type="button" className="wide-button" aria-pressed={shown} onClick={onShowPlace}><MapPin size={14}/>{shown?'Hide its place':'Show its place on the map'}</button>}
      {placeNote&&<p className="muted">{placeNote}</p>}
      <SelectField label="Trigger" field="trigger" hint="How the scene opens when it's the lead: stepping in, or talking to someone in it." value={region.trigger??''} options={[none,{value:'enter',label:'Enter'},{value:'interact',label:'Interact'}]} onChange={value=>set('trigger',value||undefined)}/>
      <TextField label="Label" field="label" hint="What the trigger says (“Step down into the Drowned Rat”)." value={region.label??''} onChange={value=>set('label',optionalText(value))}/>
    </>}
    <TextArea label="Shut" field="shut" rows={2} hint="Shut outside its scene's time: what the player is told at the door." value={region.shut??''} onChange={value=>set('shut',optionalText(value))}/>
    <SelectField label="Opens for" field="opensFor" hint="The scene whose time opens it (its own scene unless said)." value={region.opensFor??''} options={[none,...choices.scenes]} onChange={value=>set('opensFor',value||undefined)}/>
    <TextArea label="Locked after" field="lockedAfter" rows={2} hint="Locked up once its scene has been played: what the player is told." value={region.lockedAfter??''} onChange={value=>set('lockedAfter',optionalText(value))}/>
    <SelectField label="Exterior of" field="exteriorOf" hint="The outside of a scene's place on another map: it shows what the scene did to it." value={region.exteriorOf??''} options={[none,...choices.scenes]} onChange={value=>set('exteriorOf',value||undefined)}/>
    <TextField label="Locked" field="locked" hint="What its locked doors say when they're tried." value={region.locked??''} onChange={value=>set('locked',optionalText(value))}/>
    <TextArea label="Description" field="description" rows={3} value={region.description??''} onChange={value=>set('description',optionalText(value))}/>
    <div className="inspector-actions"><button type="button" className="danger" onClick={onRemove}><Trash2 size={14}/>Delete region…</button></div>
  </div>;
}

/** A way to another map: its tile here, where it lands there, and what it says. */
export function ExitInspector({doc,index,choices,onChange,onRemove,onOpen}:{doc:MapDocument;index:number;choices:Choices;onChange:(next:MapDocument)=>void;onRemove:()=>void;onOpen:(map:string)=>void}){
  const exit=doc.exits[index];
  if(!exit)return <p className="muted">That exit isn't on the map any more.</p>;
  const set=(next:MapExit)=>onChange(setExit(doc,index,next));
  return <div className="exit-inspector" data-exit={index}>
    <p className="inspector-kind"><span className="kind-dot exit"/>Exit<code>{exit.at.x}, {exit.at.y}</code></p>
    <TextField label="Label" field="label" hint="What the way says (“The Drowned Rat's door”)." value={exit.label} onChange={label=>set({...exit,label})}/>
    <TileFields label="From (tile here)" field="at" at={exit.at} onChange={at=>set({...exit,at})}/>
    <SelectField label="To map" field="to.map" hint="One of the scenario's maps." value={exit.to.map} options={choices.maps} onChange={map=>set({...exit,to:{...exit.to,map}})}/>
    <TileFields label="Lands at (tile there)" field="to.at" at={exit.to.at} onChange={at=>set({...exit,to:{...exit.to,at}})}/>
    <button type="button" className="text-button" onClick={()=>onOpen(exit.to.map)}>Open {exit.to.map} <ExternalLink size={11}/></button>
    <div className="inspector-actions"><button type="button" className="danger" onClick={onRemove}><Trash2 size={14}/>Delete exit…</button></div>
  </div>;
}

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
    <TextArea label="Text" field="text" rows={3} hint="What they say when they're talked to, or what it is when it's looked at." value={person.text} onChange={value=>set('text',value)}/>
    <ListField label="States" field="states" rows={1} items={person.states??[]} onChange={items=>set('states',optionalList(items))}/>
    <Checkbox label="Out of the way" field="blocks" hint="In the way unless this is ticked (a cat underfoot isn't)." checked={person.blocks===false} onChange={checked=>set('blocks',checked?false:undefined)}/>
    <Checklist label="Times" field="times" hint="The hours they're about." options={TIMES.map(time=>({value:time,label:time.replace('-',' ')}))} selected={person.times} onChange={times=>set('times',times)}/>
    <div className="inspector-actions"><button type="button" className="danger" onClick={onRemove}><Trash2 size={14}/>Delete…</button></div>
  </div>;
}

/** The map's own fields, and what's on it. */
export function MapPanel({doc,onChange,select,start}:{doc:MapDocument;onChange:(next:MapDocument)=>void;select:(selection:{kind:'region'|'exit'|'person';index:number}|{kind:'start'})=>void;start?:Tile2}){
  const set=(key:string,value:unknown)=>onChange(withKey(doc,key,value,ORDER.map));
  return <div className="map-panel">
    <p className="inspector-kind"><span className="kind-dot map"/>Map<code>{doc.id}</code></p>
    <TextField label="Title" field="title" hint="Its name as the game shows it." value={doc.title} onChange={value=>set('title',value)}/>
    <TextArea label="Description" field="description" rows={3} value={doc.description} onChange={value=>set('description',value)}/>
    {start&&<button type="button" className="wide-button" onClick={()=>select({kind:'start'})}>The story starts here, at ({start.x}, {start.y})</button>}
    <List title="Regions" items={doc.regions.map((region:PlaceRegion,index)=>({index,name:region.name||region.id,detail:`${region.id}${region.sceneId?` · plays ${region.sceneId}`:''}`}))} onSelect={index=>select({kind:'region',index})}/>
    <List title="Exits" items={doc.exits.map((exit,index)=>({index,name:exit.label,detail:`(${exit.at.x}, ${exit.at.y}) → ${exit.to.map} (${exit.to.at.x}, ${exit.to.at.y})`}))} onSelect={index=>select({kind:'exit',index})}/>
    <List title="People" items={(doc.people??[]).map((person,index)=>({index,name:person.name,detail:`(${person.at.x}, ${person.at.y}) · ${person.times.join(', ')}`}))} onSelect={index=>select({kind:'person',index})}/>
  </div>;
}

function List({title,items,onSelect}:{title:string;items:Array<{index:number;name:string;detail:string}>;onSelect:(index:number)=>void}){
  return <details className="route-list" open={items.length<=12}>
    <summary>{title} <span className="count">{items.length}</span></summary>
    {!items.length&&<p className="muted">None yet: right-click a tile to add one.</p>}
    {items.map(item=><button type="button" key={item.index} onClick={()=>onSelect(item.index)}><b>{item.name}</b><small>{item.detail}</small></button>)}
  </details>;
}
