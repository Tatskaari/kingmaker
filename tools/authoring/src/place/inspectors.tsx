// The inspectors for a place's parts (an area, a thing, someone who starts there) and for the place
// itself, the same on its map and on its own grid. Each edit is handed on as the whole place: the
// editor holding it writes it (its own file, or the place's from a map).
import React from 'react';
import {ExternalLink,Plus,Trash2} from 'lucide-react';
import {ListField,NumberField,SelectField,TextArea,TextField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {MATERIALS,SIZES,THING_KINDS,contentsOf,idsOf,removeFromPlace,setAreaField,setPersonField,setPlaceField,setThingField,rectLike} from './model.ts';
import type {PlaceDocument,Rect,Thing} from './model.ts';
import {optionalList,optionalText,withKey} from '../campaign/json.ts';
import {ORDER} from './model.ts';

/** What of a place is selected: an area, a thing or someone's start, by id. */
export type PlacePart={kind:'area'|'thing'|'person';id:string};

type Props={doc:PlaceDocument;onChange:(next:PlaceDocument)=>void;onSelect:(part:PlacePart|null)=>void;confirm:(title:string,description:string,label:string,run:()=>void)=>void;cast?:Array<{id:string;name:string}>};

/** The inspector for the selected part of a place. */
export function PlacePartInspector({part,...props}:Props&{part:PlacePart}){
  if(part.kind==='area')return <AreaInspector id={part.id} {...props}/>;
  if(part.kind==='thing')return <ThingInspector id={part.id} {...props}/>;
  return <PersonInspector id={part.id} {...props}/>;
}

/** Where something can be: the place's areas, and whoever or whatever can hold it. */
function holders(doc:PlaceDocument,except?:string):Option[]{
  return [
    ...doc.areas.map(area=>({value:area.id,label:`${area.name||area.id} (an area)`})),
    ...Object.keys(doc.people).map(id=>({value:id,label:`${id} (carried)`})),
    ...doc.things.filter(thing=>thing.id!==except).map(thing=>({value:thing.id,label:`${thing.name||thing.id} (in it)`})),
  ];
}

function RectFields({rect,onChange,label}:{rect:Rect;onChange:(rect:Rect)=>void;label:string}){
  const set=(key:keyof Rect,value:number)=>onChange(rectLike(rect,{...rect,[key]:value}));
  return <fieldset className="rect-field" data-field="rect">
    <legend className="field-label">{label}</legend>
    <div className="field-row">
      <NumberField label="x" min={-9999} max={9999} value={rect.x} onChange={value=>set('x',value)}/>
      <NumberField label="y" min={-9999} max={9999} value={rect.y} onChange={value=>set('y',value)}/>
      <NumberField label="w" min={1} max={9999} value={rect.w} onChange={value=>set('w',value)}/>
      <NumberField label="h" min={1} max={9999} value={rect.h} onChange={value=>set('h',value)}/>
    </div>
  </fieldset>;
}

/** A spot in feet, or none (held, or put somewhere in its area by the game). */
function SpotFields({at,onChange,label,optional=true}:{at:[number,number]|undefined;onChange:(at:[number,number]|undefined)=>void;label:string;optional?:boolean}){
  return <fieldset className="spot-field" data-field="at">
    <legend className="field-label">{label}</legend>
    {at?<div className="field-row">
      <NumberField label="x (feet)" min={-9999} max={9999} value={at[0]} onChange={value=>onChange([value,at[1]])}/>
      <NumberField label="y (feet)" min={-9999} max={9999} value={at[1]} onChange={value=>onChange([at[0],value])}/>
    </div>:<p className="muted">No spot of its own: the game puts it with whatever holds it, or somewhere in its area.</p>}
    {optional&&(at?<button type="button" className="text-button" onClick={()=>onChange(undefined)}>No spot of its own</button>:<button type="button" className="text-button" onClick={()=>onChange([0,0])}>Give it a spot</button>)}
  </fieldset>;
}

function AreaInspector({id,doc,onChange,onSelect,confirm}:Props&{id:string}){
  const area=doc.areas.find(a=>a.id===id);
  if(!area)return <p className="muted">That area isn't in the place any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setAreaField(doc,id,key,value));
  const inside=[...contentsOf(doc,id).map(t=>({kind:'thing' as const,id:t.id,name:t.name})),...Object.entries(doc.people).filter(([,p])=>p.in===id).map(([who])=>({kind:'person' as const,id:who,name:who}))];
  return <div className="place-inspector" data-place-part={`area:${id}`}>
    <p className="inspector-kind"><span className="kind-dot area"/>Area<code title="Its id: game state keys on it">{id}</code></p>
    <TextField label="Name" field="name" value={area.name} onChange={value=>set('name',value)}/>
    <RectFields label="Where (feet)" rect={area.rect} onChange={rect=>set('rect',rect)}/>
    <TextArea label="Description" field="description" rows={3} value={area.description??''} onChange={value=>set('description',optionalText(value))}/>
    <ListField label="Tags" field="tags" rows={1} items={area.tags??[]} onChange={items=>set('tags',optionalList(items))}/>
    <ListField label="States" field="states" rows={1} items={area.states??[]} onChange={items=>set('states',optionalList(items))}/>
    <div className="place-contents"><span className="field-label">In it</span>{!inside.length&&<p className="muted">Nothing yet.</p>}{inside.map(item=><button type="button" key={item.id} onClick={()=>onSelect({kind:item.kind,id:item.id})}>{item.name} <small>{item.kind==='person'?'starts here':item.id}</small></button>)}</div>
    <div className="inspector-actions">
      <button type="button" className="danger" disabled={inside.length>0} onClick={()=>confirm('Remove the area?',`Remove ${area.name||id} from the place? You can undo this.`,'Remove area',()=>{onChange(removeFromPlace(doc,id));onSelect(null)})}><Trash2 size={14}/>Remove area</button>
      {inside.length>0&&<small className="field-hint">Move or remove what's in it first.</small>}
    </div>
  </div>;
}

function ThingInspector({id,doc,onChange,onSelect,confirm}:Props&{id:string}){
  const thing=doc.things.find(t=>t.id===id);
  if(!thing)return <p className="muted">That thing isn't in the place any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setThingField(doc,id,key,value));
  const contents=contentsOf(doc,id);
  const choice=(list:readonly string[])=>[{value:'',label:'Not said'},...list.map(value=>({value,label:value}))];
  const remove=()=>{
    const all=removeFromPlace(doc,id);
    const gone=doc.things.length-all.things.length;
    confirm('Remove the thing?',`Remove ${thing.name||id} from the place${gone>1?`, and the ${gone-1} thing${gone===2?'':'s'} in it`:''}? Scenes that name it (a path's via, an effect) keep naming it, for the problems to say. You can undo this.`,'Remove thing',()=>{onChange(all);onSelect(null)});
  };
  return <div className="place-inspector" data-place-part={`thing:${id}`}>
    <p className="inspector-kind"><span className="kind-dot thing"/>Thing<code title="Its id: scenes and game state name it">{id}</code></p>
    <TextField label="Name" field="name" value={thing.name} onChange={value=>set('name',value)}/>
    <SelectField label="Kind" field="kind" value={thing.kind??''} options={choice(THING_KINDS)} onChange={value=>set('kind',value||undefined)}/>
    <SelectField label="In" field="in" hint="An area, or whoever or whatever holds it." value={thing.in} options={holders(doc,id)} onChange={value=>set('in',value)}/>
    <SpotFields label="At (feet)" at={thing.at} onChange={at=>set('at',at)}/>
    <div className="field-row">
      <SelectField label="Size" field="size" value={thing.size??''} options={choice(SIZES)} onChange={value=>set('size',value||undefined)}/>
      <SelectField label="Material" field="material" value={thing.material??''} options={choice(MATERIALS)} onChange={value=>set('material',value||undefined)}/>
    </div>
    <ListField label="States" field="states" rows={1} items={thing.states??[]} onChange={items=>set('states',optionalList(items))}/>
    <ListField label="Tags" field="tags" rows={1} items={thing.tags??[]} onChange={items=>set('tags',optionalList(items))}/>
    <div className="place-contents" data-field="contents"><span className="field-label">Contents</span>
      {!contents.length&&<p className="muted">Nothing in it.</p>}
      {contents.map(item=><button type="button" key={item.id} onClick={()=>onSelect({kind:'thing',id:item.id})}>{item.name||item.id} <small>{item.id}</small></button>)}
    </div>
    <TextArea label="Description" field="description" rows={3} value={thing.description??''} onChange={value=>set('description',optionalText(value))}/>
    <div className="inspector-actions"><button type="button" className="danger" onClick={remove}><Trash2 size={14}/>Remove thing</button></div>
  </div>;
}

function PersonInspector({id,doc,onChange,onSelect,confirm,cast}:Props&{id:string}){
  const person=doc.people[id];
  if(!person)return <p className="muted">{id} doesn't start here any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setPersonField(doc,id,key,value));
  const name=id==='player'?'The player':cast?.find(member=>member.id===id)?.name??id;
  return <div className="place-inspector" data-place-part={`person:${id}`}>
    <p className="inspector-kind"><span className="kind-dot person"/>{name}<code title="Their cast id">{id}</code></p>
    <SelectField label="In" field="in" hint="The area they start in." value={person.in} options={doc.areas.map(area=>({value:area.id,label:area.name||area.id}))} onChange={value=>set('in',value)}/>
    <SpotFields label="At (feet)" at={person.at} onChange={at=>set('at',at)}/>
    <TextArea label="Note" field="note" rows={2} hint="Where they are and what they're doing as the scene opens." value={person.note??''} onChange={value=>set('note',optionalText(value))}/>
    <div className="inspector-actions"><button type="button" className="danger" onClick={()=>confirm('Remove their start?',`${name} won't start in the place. What they carry stays, for the problems to name. You can undo this.`,'Remove',()=>{onChange(removeFromPlace(doc,id));onSelect(null)})}><Trash2 size={14}/>Remove their start</button></div>
  </div>;
}

/** The place itself: its name and prose, its size, and lists of its parts. */
export function PlacePanel({doc,onChange,onSelect,onAdd,openFile,path}:{doc:PlaceDocument;onChange:(next:PlaceDocument)=>void;onSelect:(part:PlacePart)=>void;onAdd?:(kind:'area'|'thing'|'person')=>void;openFile?:()=>void;path?:string}){
  const set=(key:string,value:unknown)=>onChange(setPlaceField(doc,key,value));
  const setSize=(key:'w'|'h',value:number)=>onChange(setPlaceField(doc,'size',withKey(doc.size,key,value,ORDER.size)));
  const floor=doc.things.filter(thing=>thing.at);
  return <div className="place-panel" data-place={doc.id}>
    <p className="inspector-kind"><span className="kind-dot place"/>Place<code>{doc.id}</code></p>
    {path&&<p className="muted place-path"><code>{path}</code>{openFile&&<button type="button" className="text-button" onClick={openFile}>Open it <ExternalLink size={11}/></button>}</p>}
    <TextField label="Title" field="title" value={doc.title} onChange={value=>set('title',value)}/>
    <TextArea label="Description" field="description" rows={3} value={doc.description} onChange={value=>set('description',value)}/>
    <div className="field-row">
      <NumberField label="Width (feet)" min={5} max={9999} value={doc.size.w} onChange={value=>setSize('w',value)}/>
      <NumberField label="Depth (feet)" min={5} max={9999} value={doc.size.h} onChange={value=>setSize('h',value)}/>
    </div>
    <PartList title="Areas" items={doc.areas.map(area=>({id:area.id,name:area.name,detail:`${area.rect.w} × ${area.rect.h} ft`}))} onSelect={id=>onSelect({kind:'area',id})} onAdd={onAdd&&(()=>onAdd('area'))}/>
    <PartList title="Things" items={doc.things.map(thing=>({id:thing.id,name:thing.name,detail:thing.at?`at ${thing.at[0]}, ${thing.at[1]} ft`:`in ${thing.in}`}))} onSelect={id=>onSelect({kind:'thing',id})} onAdd={onAdd&&(()=>onAdd('thing'))}/>
    <PartList title="Who starts here" items={Object.entries(doc.people).map(([id,p])=>({id,name:id,detail:`in ${p.in}`}))} onSelect={id=>onSelect({kind:'person',id})} onAdd={onAdd&&(()=>onAdd('person'))}/>
    <p className="muted">{floor.length} of its {doc.things.length} things have a spot of their own; the rest are held by someone or something.</p>
  </div>;
}

function PartList({title,items,onSelect,onAdd}:{title:string;items:Array<{id:string;name:string;detail:string}>;onSelect:(id:string)=>void;onAdd?:()=>void}){
  return <details className="route-list" open>
    <summary>{title} <span className="count">{items.length}</span></summary>
    {items.map(item=><button type="button" key={item.id} onClick={()=>onSelect(item.id)}><b>{item.name||item.id}</b><small>{item.id} · {item.detail}</small></button>)}
    {onAdd&&<button type="button" className="add-item" onClick={onAdd}><Plus size={13}/>Add</button>}
  </details>;
}

/** The ids a thing could be given, and whether one's taken: for the add dialogs. */
export const takenIds=(doc:PlaceDocument)=>[...idsOf(doc).keys()];
export type {Thing};
