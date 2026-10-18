// The forms for a place's parts (an area, a thing, someone who starts there), the same on its map and
// on its own plan, in the inspector and in the place's views. Each edit is handed on as the whole
// place: the editor holding it writes it (its own file, or the place's from a map).
import React from 'react';
import {Plus,Trash2} from 'lucide-react';
import {IdField,NumberField,OptionalSection,SelectField,TextArea,TextField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {MATERIALS,ORDER,SIZES,THING_KINDS,contentsOf,idsOf,placeIdProblem,removeFromPlace,renamePlaceId,setAreaField,setPersonField,setThingField,rectLike} from './model.ts';
import type {Feet,PlaceDocument,Rect,Thing} from './model.ts';
import {optionalList,optionalText} from '../campaign/json.ts';
import {Uses,WordChips} from '../campaign/views.tsx';
import type {Use} from '../campaign/views.tsx';
import {OptionalNumber} from '../map/inspectors.tsx';

/** What of a place is selected: an area, a thing or someone's start, by id. */
export type PlacePart={kind:'area'|'thing'|'person';id:string};

type Props={
  doc:PlaceDocument;
  onChange:(next:PlaceDocument)=>void;
  onSelect:(part:PlacePart|null)=>void;
  confirm:(title:string,description:string,label:string,run:()=>void)=>void;
  cast?:Array<{id:string;name:string}>;
  /** Where the campaign's scenes name a part (a path's via, an effect), each a link there. */
  uses?:(part:PlacePart)=>Use[];
  /** Something added in an area: a thing, or someone's start (at the spot last clicked in it, or its middle). */
  onAdd?:(kind:'thing'|'starts',area:string)=>void;
  /** A part renamed (its selection follows). */
  onRenamed?:(part:PlacePart,to:string)=>void;
};

/** The inspector for the selected part of a place. */
export function PlacePartInspector({part,...props}:Props&{part:PlacePart}){
  if(part.kind==='area')return <AreaInspector id={part.id} {...props}/>;
  if(part.kind==='thing')return <ThingInspector id={part.id} {...props}/>;
  return <PersonInspector id={part.id} {...props}/>;
}

/** Where something can be: the place's areas, and whoever or whatever can hold it. */
export function holders(doc:PlaceDocument,except?:string):Option[]{
  return [
    ...doc.areas.map(area=>({value:area.id,label:`${area.name||area.id} (an area)`})),
    ...Object.keys(doc.people).map(id=>({value:id,label:`${id} (carried)`})),
    ...doc.things.filter(thing=>thing.id!==except).map(thing=>({value:thing.id,label:`${thing.name||thing.id} (in it)`})),
  ];
}

export function RectFields({rect,onChange,label}:{rect:Rect;onChange:(rect:Rect)=>void;label:string}){
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
export function SpotFields({at,onChange,label,optional=true,give=[0,0]}:{at:[number,number]|undefined;onChange:(at:[number,number]|undefined)=>void;label:string;optional?:boolean;give?:Feet}){
  return <fieldset className="spot-field" data-field="at">
    <legend className="field-label">{label}</legend>
    {at?<div className="field-row">
      <NumberField label="x (feet)" min={-9999} max={9999} value={at[0]} onChange={value=>onChange([value,at[1]])}/>
      <NumberField label="y (feet)" min={-9999} max={9999} value={at[1]} onChange={value=>onChange([at[0],value])}/>
    </div>:<p className="muted">No spot of its own: the game puts it with whatever holds it, or somewhere in its area.</p>}
    {optional&&(at?<button type="button" className="text-button" onClick={()=>onChange(undefined)}>No spot of its own</button>:<button type="button" className="text-button" onClick={()=>onChange([give[0],give[1]])}><Plus size={12}/>Give it a spot</button>)}
  </fieldset>;
}

const nameOf=(doc:PlaceDocument,id:string,cast?:Array<{id:string;name:string}>)=>doc.areas.find(a=>a.id===id)?.name||doc.things.find(t=>t.id===id)?.name||(id==='player'?'the player':cast?.find(member=>member.id===id)?.name)||id;
const areaMiddle=(rect:Rect):Feet=>[Math.round(rect.x+rect.w/2),Math.round(rect.y+rect.h/2)];

function AreaInspector({id,doc,onChange,onSelect,confirm,cast,onAdd,onRenamed}:Props&{id:string}){
  const area=doc.areas.find(a=>a.id===id);
  if(!area)return <p className="muted">That area isn't in the place any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setAreaField(doc,id,key,value));
  const inside:Use[]=[...contentsOf(doc,id).map(t=>({key:t.id,label:t.name||t.id,detail:t.at?`at ${t.at[0]}, ${t.at[1]} ft`:'a thing',onOpen:()=>onSelect({kind:'thing',id:t.id})})),...Object.entries(doc.people).filter(([,p])=>p.in===id).map(([who])=>({key:who,label:nameOf(doc,who,cast),detail:'starts here',onOpen:()=>onSelect({kind:'person',id:who})}))];
  return <div className="place-inspector" data-place-part={`area:${id}`}>
    <p className="inspector-kind"><span className="kind-dot area"/>Area<code title="Its id: game state keys on it">{id}</code></p>
    <TextField label="Name" field="name" value={area.name} onChange={value=>set('name',value)}/>
    <IdField id={id} label="Area id" problem={next=>placeIdProblem(doc,next,id)} onRename={to=>{try{onChange(renamePlaceId(doc,id,to));onRenamed?.({kind:'area',id},to)}catch{}}}
      warning="What's in it follows. A scene naming it (a path's via, an effect) isn't the place's: the problems say where. Game state keys on it."/>
    <RectFields label="Where (feet)" rect={area.rect} onChange={rect=>set('rect',rect)}/>
    <TextArea label="Description" field="description" rows={3} value={area.description??''} onChange={value=>set('description',optionalText(value))}/>
    <WordChips label="Tags" field="tags" addLabel="Add a tag" placeholder="outdoors" words={area.tags??[]} onChange={words=>set('tags',optionalList(words))}/>
    <WordChips label="States" field="states" addLabel="Add a state" placeholder="dark" words={area.states??[]} onChange={words=>set('states',optionalList(words))}/>
    <Uses title="In it" uses={inside} none="Nothing yet."/>
    {onAdd&&<div className="tile-actions"><button type="button" onClick={()=>onAdd('thing',id)}>Add a thing in it…</button><button type="button" onClick={()=>onAdd('starts',id)}>Start someone in it…</button></div>}
    <div className="inspector-actions">
      <button type="button" className="danger" disabled={inside.length>0} onClick={()=>confirm('Remove the area?',`Remove ${area.name||id} from the place? You can undo this.`,'Remove area',()=>{onChange(removeFromPlace(doc,id));onSelect(null)})}><Trash2 size={14}/>Remove area</button>
      {inside.length>0&&<small className="field-hint">Move or remove what's in it first.</small>}
    </div>
  </div>;
}

function ThingInspector({id,doc,onChange,onSelect,confirm,uses,onRenamed}:Props&{id:string}){
  const thing=doc.things.find(t=>t.id===id);
  if(!thing)return <p className="muted">That thing isn't in the place any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setThingField(doc,id,key,value));
  const contents=contentsOf(doc,id);
  const choice=(list:readonly string[])=>[{value:'',label:'Not said'},...list.map(value=>({value,label:value}))];
  const area=doc.areas.find(a=>a.id===thing.in);
  const remove=()=>{
    const all=removeFromPlace(doc,id);
    const gone=doc.things.length-all.things.length;
    confirm('Remove the thing?',`Remove ${thing.name||id} from the place${gone>1?`, and the ${gone-1} thing${gone===2?'':'s'} in it`:''}? Scenes that name it (a path's via, an effect) keep naming it, for the problems to say. You can undo this.`,'Remove thing',()=>{onChange(all);onSelect(null)});
  };
  return <div className="place-inspector" data-place-part={`thing:${id}`}>
    <p className="inspector-kind"><span className="kind-dot thing"/>Thing<code title="Its id: scenes and game state name it">{id}</code></p>
    <TextField label="Name" field="name" value={thing.name} onChange={value=>set('name',value)}/>
    <IdField id={id} label="Thing id" problem={next=>placeIdProblem(doc,next,id)} onRename={to=>{try{onChange(renamePlaceId(doc,id,to));onRenamed?.({kind:'thing',id},to)}catch{}}}
      warning="What's in it follows. The scenes naming it (a path's via, an effect) aren't the place's: the problems and warnings say where. Game state keys on it."/>
    <SelectField label="Kind" field="kind" value={thing.kind??''} options={choice(THING_KINDS)} onChange={value=>set('kind',value||undefined)}/>
    <SelectField label="In" field="in" hint="An area, or whoever or whatever holds it." value={thing.in} options={holders(doc,id)} onChange={value=>set('in',value)}/>
    <SpotFields label="At (feet)" at={thing.at} onChange={at=>set('at',at)} give={area?areaMiddle(area.rect):[0,0]}/>
    <div className="field-row">
      <SelectField label="Size" field="size" value={thing.size??''} options={choice(SIZES)} onChange={value=>set('size',value||undefined)}/>
      <SelectField label="Material" field="material" value={thing.material??''} options={choice(MATERIALS)} onChange={value=>set('material',value||undefined)}/>
    </div>
    <WordChips label="States" field="states" addLabel="Add a state" placeholder="hanging" words={thing.states??[]} onChange={words=>set('states',optionalList(words))}/>
    <WordChips label="Tags" field="tags" addLabel="Add a tag" placeholder="evidence" words={thing.tags??[]} onChange={words=>set('tags',optionalList(words))}/>
    <TextArea label="Description" field="description" rows={3} value={thing.description??''} onChange={value=>set('description',optionalText(value))}/>
    <OptionalSection title="Its own armour and hit points" field="ac" present={thing.ac!==undefined||thing.hp!==undefined} addLabel="Its own armour and hit points" hint="Unless said, a thing's AC is its material's and its HP its size's (the rules' objects)." onRemove={()=>onChange(setThingField(setThingField(doc,id,'ac',undefined),id,'hp',undefined))}>
      <div className="field-row">
        <OptionalNumber label="AC" field="ac" min={0} max={40} value={thing.ac} onChange={value=>set('ac',value)}/>
        <OptionalNumber label="HP" field="hp" min={0} max={999} value={thing.hp} onChange={value=>set('hp',value)}/>
      </div>
    </OptionalSection>
    <OptionalNumber label="How many" field="quantity" min={1} max={99999} placeholder="one" hint="For a stack: a shilling left on a table is one of them (it joins the purse's shillings)." value={thing.quantity} onChange={value=>set('quantity',value)}/>
    <Uses title="Contents" field="contents" uses={contents.map(item=>({key:item.id,label:item.name||item.id,detail:item.id,onOpen:()=>onSelect({kind:'thing',id:item.id})}))} none="Nothing in it."/>
    {uses&&<Uses title="Named by" field="namedBy" uses={uses({kind:'thing',id})} none="No scene of this place names it yet (a path's via, an effect)."/>}
    <div className="inspector-actions"><button type="button" className="danger" onClick={remove}><Trash2 size={14}/>Remove thing</button></div>
  </div>;
}

function PersonInspector({id,doc,onChange,onSelect,confirm,cast,uses}:Props&{id:string}){
  const person=doc.people[id];
  if(!person)return <p className="muted">{id} doesn't start here any more.</p>;
  const set=(key:string,value:unknown)=>onChange(setPersonField(doc,id,key,value));
  const name=id==='player'?'The player':cast?.find(member=>member.id===id)?.name??id;
  const area=doc.areas.find(a=>a.id===person.in);
  const carried=contentsOf(doc,id);
  return <div className="place-inspector" data-place-part={`person:${id}`}>
    <p className="inspector-kind"><span className="kind-dot person"/>{name}<code title="Their cast id">{id}</code></p>
    <SelectField label="In" field="in" hint="The area they start in." value={person.in} options={doc.areas.map(a=>({value:a.id,label:a.name||a.id}))} onChange={value=>set('in',value)}/>
    <SpotFields label="At (feet)" at={person.at} onChange={at=>set('at',at)} give={area?areaMiddle(area.rect):[0,0]}/>
    <TextArea label="Note" field="note" rows={2} hint="Where they are and what they're doing as the scene opens." value={person.note??''} onChange={value=>set('note',optionalText(value))}/>
    <Uses title="Carries" uses={carried.map(item=>({key:item.id,label:item.name||item.id,detail:item.id,onOpen:()=>onSelect({kind:'thing',id:item.id})}))} none="Nothing of the place."/>
    {uses&&<Uses title="Who they are" uses={uses({kind:'person',id})} none={id==='player'?'The player: whoever is playing.':'Not in the cast of a scene played here: the problems say so.'}/>}
    <div className="inspector-actions"><button type="button" className="danger" onClick={()=>confirm('Remove their start?',`${name} won't start in the place. What they carry stays, for the problems to name. You can undo this.`,'Remove',()=>{onChange(removeFromPlace(doc,id));onSelect(null)})}><Trash2 size={14}/>Remove their start</button></div>
  </div>;
}

/** The ids a thing could be given, and whether one's taken: for the add dialogs. */
export const takenIds=(doc:PlaceDocument)=>[...idsOf(doc).keys()];
export type {Thing};
