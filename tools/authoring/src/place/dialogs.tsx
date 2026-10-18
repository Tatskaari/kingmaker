// A place's dialogs for something new: a thing, an area, someone who starts there.
import React,{useState} from 'react';
import {Plus} from 'lucide-react';
import {Dialog} from '../campaign/Dialog.tsx';
import {NumberField,SelectField,TextField} from '../scene/fields.tsx';
import {placeIdFor} from './model.ts';
import type {Feet,PlaceDocument,Rect} from './model.ts';

/** A new thing: its name and id (a slug of the name, free in the place), where it is, and its spot. */
export function NewThingDialog({doc,at,area,onAdd,onClose}:{doc:PlaceDocument;at:Feet;area?:string;onAdd:(thing:{id:string;name:string;in:string;at:Feet})=>void;onClose:()=>void}){
  const [name,setName]=useState(''),[id,setId]=useState(''),[where,setWhere]=useState(area??doc.areas[0]?.id??'');
  const preview=placeIdFor(doc,name,id);
  const ready=name.trim().length>0&&!!where;
  return <Dialog label="New thing" title={`A thing of ${doc.title||doc.id}`} onClose={onClose} footer={<button type="button" className="primary" disabled={!ready} onClick={()=>onAdd({id:preview,name:name.trim(),in:where,at})}><Plus size={14}/>Add thing</button>}>
    <TextField label="Name" field="name" placeholder="a loose board" value={name} onChange={setName}/>
    <TextField label="Id" field="id" placeholder={preview} hint={`Its id is ${preview}: scenes name it (a path's via, an effect), and game state keys on it.`} value={id} onChange={setId}/>
    <SelectField label="In" field="in" value={where} options={doc.areas.map(a=>({value:a.id,label:a.name||a.id}))} onChange={setWhere}/>
    <p className="muted">At {at[0]}, {at[1]} feet.</p>
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
  </Dialog>;
}

/** Someone who starts in the place: one of its scene's cast not placed yet (or the player), in an area, at a spot. */
export function NewStartDialog({doc,at,area,cast,onAdd,onClose}:{doc:PlaceDocument;at:Feet;area?:string;cast:Array<{id:string;name:string}>;onAdd:(id:string,where:{in:string;at:Feet})=>void;onClose:()=>void}){
  const choices=[...(doc.people.player?[]:[{value:'player',label:'The player'}]),...cast.filter(member=>!(member.id in doc.people)).map(member=>({value:member.id,label:`${member.name} (${member.id})`}))];
  const [who,setWho]=useState(choices[0]?.value??''),[where,setWhere]=useState(area??doc.areas[0]?.id??'');
  return <Dialog label="Someone starts here" title="Someone starts here" onClose={onClose} footer={<button type="button" className="primary" disabled={!who||!where} onClick={()=>onAdd(who,{in:where,at})}><Plus size={14}/>Start them here</button>}>
    {choices.length?<SelectField label="Who" field="who" hint="The scene's cast who don't start here yet, or the player." value={who} options={choices} onChange={setWho}/>:<p className="muted">Everyone of the scene's cast starts here already.</p>}
    <SelectField label="In" field="in" value={where} options={doc.areas.map(a=>({value:a.id,label:a.name||a.id}))} onChange={setWhere}/>
    <p className="muted">At {at[0]}, {at[1]} feet.</p>
  </Dialog>;
}
