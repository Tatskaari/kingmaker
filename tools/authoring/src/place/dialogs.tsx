// A place's dialogs for something new: a thing, an area, someone who starts there. Added where the plan
// (or the map) was clicked, the spot is that one; added from a view, it's asked for.
import React,{useState} from 'react';
import {Plus} from 'lucide-react';
import {Dialog} from '../campaign/Dialog.tsx';
import {NumberField,SelectField,TextField} from '../scene/fields.tsx';
import {placeIdFor} from './model.ts';
import {slugOf} from '../campaign/json.ts';
import type {Feet,PlaceDocument,Rect} from './model.ts';

/** A spot in feet, as two numbers. */
function FeetFields({label,at,onChange}:{label:string;at:Feet;onChange:(at:Feet)=>void}){
  return <fieldset className="spot-field">
    <legend className="field-label">{label}</legend>
    <div className="field-row">
      <NumberField label="x (feet)" min={0} max={9999} value={at[0]} onChange={value=>onChange([value,at[1]])}/>
      <NumberField label="y (feet)" min={0} max={9999} value={at[1]} onChange={value=>onChange([at[0],value])}/>
    </div>
  </fieldset>;
}

/** A new thing: its name and id (a slug of the name, free in the place), what it's in (an area, someone, another thing), and on the floor its spot. */
export function NewThingDialog({doc,at,area,fixed=true,onAdd,onClose}:{doc:PlaceDocument;at:Feet;area?:string;fixed?:boolean;onAdd:(thing:{id:string;name:string;in:string;at?:Feet})=>void;onClose:()=>void}){
  const [name,setName]=useState(''),[id,setId]=useState(''),[where,setWhere]=useState(area??doc.areas[0]?.id??''),[spot,setSpot]=useState<Feet>(at);
  const preview=placeIdFor(doc,name,id);
  const onFloor=doc.areas.some(a=>a.id===where);
  const ready=name.trim().length>0&&!!where;
  const options=[
    ...doc.areas.map(a=>({value:a.id,label:`${a.name||a.id} (an area)`})),
    ...Object.keys(doc.people).map(who=>({value:who,label:`${who} (carried)`})),
    ...doc.things.map(t=>({value:t.id,label:`${t.name||t.id} (in it)`})),
  ];
  return <Dialog label="New thing" title={`A thing of ${doc.title||doc.id}`} onClose={onClose} footer={<button type="button" className="primary" disabled={!ready} onClick={()=>onAdd({id:preview,name:name.trim(),in:where,...(onFloor?{at:spot}:{})})}><Plus size={14}/>Add thing</button>}>
    <TextField label="Name" field="name" placeholder="a loose board" value={name} onChange={setName}/>
    <TextField label="Id" field="id" placeholder={preview} hint={`Its id is ${preview}: scenes name it (a path's via, an effect), and game state keys on it.`} value={id} onChange={setId}/>
    <SelectField label="In" field="in" hint="An area (it stands on the floor), or whoever or whatever holds it." value={where} options={options} onChange={setWhere}/>
    {onFloor&&(fixed?<p className="muted">At {spot[0]}, {spot[1]} feet.</p>:<FeetFields label="At (feet)" at={spot} onChange={setSpot}/>)}
    {!onFloor&&<p className="muted">Held: it has no spot of its own, and goes where its holder does.</p>}
  </Dialog>;
}

/** A new area: its name and id, and its rect in feet. */
export function NewAreaDialog({doc,rect,onAdd,onClose}:{doc:PlaceDocument;rect:Rect;onAdd:(area:{id:string;name:string;rect:Rect})=>void;onClose:()=>void}){
  const [name,setName]=useState(''),[id,setId]=useState(''),[where,setWhere]=useState(rect);
  const preview=placeIdFor(doc,name,id);
  const ready=name.trim().length>0;
  return <Dialog label="New area" title={`An area of ${doc.title||doc.id}`} onClose={onClose} footer={<button type="button" className="primary" disabled={!ready} onClick={()=>onAdd({id:preview,name:name.trim(),rect:where})}><Plus size={14}/>Add area</button>}>
    <TextField label="Name" field="name" placeholder="the cellar" value={name} onChange={setName}/>
    <TextField label="Id" field="id" placeholder={preview} hint={`Its id is ${preview}.`} value={id} onChange={setId}/>
    <div className="field-row">
      <NumberField label="x" min={-9999} max={9999} value={where.x} onChange={x=>setWhere({...where,x})}/>
      <NumberField label="y" min={-9999} max={9999} value={where.y} onChange={y=>setWhere({...where,y})}/>
      <NumberField label="w" min={1} max={9999} value={where.w} onChange={w=>setWhere({...where,w})}/>
      <NumberField label="h" min={1} max={9999} value={where.h} onChange={h=>setWhere({...where,h})}/>
    </div>
    <p className="muted">In feet, from the place's north-west corner ({doc.size.w} × {doc.size.h} feet).</p>
  </Dialog>;
}

/** Someone made for a scene's cast where they're started in its place: their name, an id that's a slug of it unless one's typed, and the scene. */
export type NewCast={scene:string;name:string};

const NEW='+new';

/**
 * Someone who starts in the place: one of its scene's cast not placed yet (or the player), or someone
 * new of a scene played there (made in its cast, as one step with their start), in an area, at a spot.
 */
export function NewStartDialog({doc,at,area,fixed=true,cast,scenes=[],onAdd,onClose}:{doc:PlaceDocument;at:Feet;area?:string;fixed?:boolean;cast:Array<{id:string;name:string}>;scenes?:Array<{key:string;title:string}>;onAdd:(id:string,where:{in:string;at:Feet},created?:NewCast)=>void;onClose:()=>void}){
  const choices=[...(doc.people.player?[]:[{value:'player',label:'The player'}]),...cast.filter(member=>!(member.id in doc.people)).map(member=>({value:member.id,label:`${member.name} (${member.id})`})),...(scenes.length?[{value:NEW,label:'Someone new, of the scene\'s cast…'}]:[])];
  const [who,setWho]=useState(choices[0]?.value??''),[where,setWhere]=useState(area??doc.areas[0]?.id??''),[spot,setSpot]=useState<Feet>(at);
  const [name,setName]=useState(''),[id,setId]=useState(''),[scene,setScene]=useState(scenes[0]?.key??'');
  const fresh=who===NEW,newId=slugOf(id)||slugOf(name);
  const taken=fresh&&!!newId&&(newId in doc.people||cast.some(member=>member.id===newId));
  const ready=!!where&&(fresh?!!name.trim()&&!!newId&&!taken&&!!scene:!!who);
  const add=()=>fresh?onAdd(newId,{in:where,at:spot},{scene,name:name.trim()}):onAdd(who,{in:where,at:spot});
  return <Dialog label="Someone starts here" title="Someone starts here" onClose={onClose} footer={<button type="button" className="primary" disabled={!ready} onClick={add}><Plus size={14}/>Start them here</button>}>
    {choices.length?<SelectField label="Who" field="who" hint="The scene's cast who don't start here yet, the player, or someone new of the cast." value={who} options={choices} onChange={setWho}/>:<p className="muted">No scene is played here yet: a scene's Place names it, and its cast start here.</p>}
    {fresh&&<div className="new-cast">
      <TextField label="Their name" field="name" placeholder="Maud Tallis" value={name} onChange={setName}/>
      <TextField label="Their id" field="id" placeholder={newId||'maud'} hint={taken?`${newId} is in the cast or the place already.`:'How the GM, the paths and the effects name them: short (“maud”).'} value={id} onChange={setId}/>
      {scenes.length>1&&<SelectField label="Of the scene" field="scene" value={scene} options={scenes.map(item=>({value:item.key,label:item.title}))} onChange={setScene}/>}
      <p className="muted">They're added to {scenes.find(item=>item.key===scene)?.title??scene}'s cast with their start here, in one step: write their card there (the scene's problems say what it needs).</p>
    </div>}
    <SelectField label="In" field="in" value={where} options={doc.areas.map(a=>({value:a.id,label:a.name||a.id}))} onChange={setWhere}/>
    {fixed?<p className="muted">At {spot[0]}, {spot[1]} feet.</p>:<FeetFields label="At (feet)" at={spot} onChange={setSpot}/>}
  </Dialog>;
}
