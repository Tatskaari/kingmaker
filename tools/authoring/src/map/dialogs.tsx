// The map editor's dialogs for something new: a legend entry, a region, an exit, someone about; and
// for taking a legend entry out of a map that's painted with it.
import React,{useState} from 'react';
import {Plus,Trash2} from 'lucide-react';
import {Dialog} from '../campaign/Dialog.tsx';
import {NumberField,SelectField,TextField} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {DEFAULT_LEGEND,VOID,cleanEntry,entryName,freeChar,legendCharProblem,regionIdFor} from './model.ts';
import type {LegendEntry,MapDocument,MapExit,Tile2} from './model.ts';
import {LegendEntryForm,TileFields} from './inspectors.tsx';
import {swatchOf} from './look.ts';

/** A new legend entry: its character, and its fields, from scratch or from one of the default legend's. */
export function NewLegendEntryDialog({doc,onAdd,onClose}:{doc:MapDocument;onAdd:(ch:string,entry:LegendEntry)=>void;onClose:()=>void}){
  const [ch,setCh]=useState(()=>freeChar(doc));
  const [entry,setEntry]=useState<LegendEntry>({terrain:'cobbles'});
  const problem=legendCharProblem(doc,ch);
  const preset=(id:string)=>{const item=DEFAULT_LEGEND.find(candidate=>candidate.id===id);if(item){setEntry(structuredClone(item.entry));if(!legendCharProblem(doc,item.ch))setCh(item.ch)}};
  return <Dialog label="New legend entry" title="New legend entry" onClose={onClose} wide footer={<>
    <span className="legend-preview"><span className="legend-swatch" style={{background:swatchOf(entry)}}/>{entryName(cleanEntry(entry))}</span>
    <button type="button" className="primary" disabled={!!problem} onClick={()=>onAdd(ch,cleanEntry(entry))}><Plus size={14}/>Add entry</button>
  </>}>
    <div className="field-row">
      <TextField label="Character" field="char" hint={problem??'The character the grid is written in: one you can see, not in the legend yet.'} value={ch} onChange={setCh}/>
      <SelectField label="Start from" field="preset" hint="One of the default legend's entries, to change." value="" options={[{value:'',label:'Choose…'},...DEFAULT_LEGEND.map(item=>({value:item.id,label:`${item.clutter?'Clutter: ':''}${entryName(item.entry)}`}))]} onChange={preset}/>
    </div>
    <LegendEntryForm entry={entry} onChange={setEntry}/>
  </Dialog>;
}

/** A legend entry taken out: what replaces it where the map is painted with it. */
export function RemoveLegendEntryDialog({doc,ch,uses,onRemove,onClose}:{doc:MapDocument;ch:string;uses:number;onRemove:(replacement?:string)=>void;onClose:()=>void}){
  const others:Option[]=[...Object.keys(doc.legend).filter(other=>other!==ch).map(other=>({value:other,label:`“${other}” ${entryName(doc.legend[other])}`})),{value:VOID,label:'The void (no tile)'}];
  const [replacement,setReplacement]=useState(others[0]?.value??VOID);
  return <Dialog label="Delete legend entry" title={`Delete “${ch}”?`} onClose={onClose} footer={<>
    <button type="button" onClick={onClose}>Cancel</button>
    <button type="button" className="danger" onClick={()=>onRemove(uses?replacement:undefined)}><Trash2 size={14}/>Delete entry</button>
  </>}>
    <p>{entryName(doc.legend[ch])}: {uses?`${uses} tile${uses===1?' is':'s are'} painted with it.`:'nothing is painted with it.'} You can undo this.</p>
    {uses>0&&<SelectField label="Paint its tiles with" field="replacement" value={replacement} options={others} onChange={setReplacement}/>}
  </Dialog>;
}

/** A new region: its name and id (a slug of the name, unique across the campaign's maps), and where it is. */
export function NewRegionDialog({rect,taken,onAdd,onClose}:{rect:{x:number;y:number;w:number;h:number};taken:string[];onAdd:(region:{id:string;name:string;rect:{x:number;y:number;w:number;h:number}})=>void;onClose:()=>void}){
  const [name,setName]=useState(''),[id,setId]=useState(''),[where,setWhere]=useState(rect);
  const preview=regionIdFor(name,taken,id);
  const ready=name.trim().length>0;
  return <Dialog label="New region" title="New region" onClose={onClose} footer={<button type="button" className="primary" disabled={!ready} onClick={()=>onAdd({id:preview,name:name.trim(),rect:where})}><Plus size={14}/>Add region</button>}>
    <TextField label="Name" field="name" placeholder="the cooperage" value={name} onChange={setName}/>
    <TextField label="Id" field="id" placeholder={preview} hint={`Its id is ${preview}: game state keys on it, so it stays when the name changes.`} value={id} onChange={setId}/>
    <div className="field-row">
      <NumberField label="x" min={0} max={159} value={where.x} onChange={x=>setWhere({...where,x})}/>
      <NumberField label="y" min={0} max={119} value={where.y} onChange={y=>setWhere({...where,y})}/>
      <NumberField label="w" min={1} max={160} value={where.w} onChange={w=>setWhere({...where,w})}/>
      <NumberField label="h" min={1} max={120} value={where.h} onChange={h=>setWhere({...where,h})}/>
    </div>
  </Dialog>;
}

/** A new exit: its tile here (asked for unless it's the tile it was added on), where it goes (one of the scenario's maps, and a tile there) and what it says. */
export function NewExitDialog({at,fixed,maps,landing,onAdd,onClose}:{at:Tile2;fixed?:boolean;maps:Option[];landing:(map:string)=>Tile2;onAdd:(exit:MapExit)=>void;onClose:()=>void}){
  const [map,setMap]=useState(maps[0]?.value??''),[label,setLabel]=useState(''),[to,setTo]=useState<Tile2>(()=>maps[0]?landing(maps[0].value):{x:0,y:0}),[from,setFrom]=useState<Tile2>(at);
  const ready=!!map&&label.trim().length>0;
  return <Dialog label="New exit" title={fixed?`New exit at (${at.x}, ${at.y})`:'New exit'} onClose={onClose} footer={<button type="button" className="primary" disabled={!ready} onClick={()=>onAdd({at:{x:from.x,y:from.y},to:{map,at:to},label:label.trim()})}><Plus size={14}/>Add exit</button>}>
    <TextField label="Label" field="label" placeholder="Down to the wharves" value={label} onChange={setLabel}/>
    {!fixed&&<TileFields label="From (tile here)" at={from} onChange={setFrom}/>}
    {maps.length?<SelectField label="To map" field="to.map" value={map} options={maps} onChange={value=>{setMap(value);setTo(landing(value))}}/>:<p className="muted">The scenario has no maps to go to yet.</p>}
    <TileFields label="Lands at (tile there)" at={to} onChange={setTo}/>
  </Dialog>;
}

/** Someone new about on the map: a name and a glyph (and a tile, unless it's the tile they were added on), about all day until the author says otherwise. */
export function NewPersonDialog({at,fixed,onAdd,onClose}:{at:Tile2;fixed?:boolean;onAdd:(person:{name:string;glyph:string;at:Tile2})=>void;onClose:()=>void}){
  const [name,setName]=useState(''),[glyph,setGlyph]=useState('p'),[where,setWhere]=useState<Tile2>(at);
  const ready=name.trim().length>0&&[...glyph].length===1;
  return <Dialog label="New person" title={fixed?`Someone about at (${at.x}, ${at.y})`:'Someone about'} onClose={onClose} footer={<button type="button" className="primary" disabled={!ready} onClick={()=>onAdd({name:name.trim(),glyph,at:{x:where.x,y:where.y}})}><Plus size={14}/>Add</button>}>
    <TextField label="Name" field="name" placeholder="a lamplighter" value={name} onChange={setName}/>
    <TextField label="Glyph" field="glyph" hint="One character, as the map draws them." value={glyph} onChange={setGlyph}/>
    {!fixed&&<TileFields label="Stands at (tile)" at={where} onChange={setWhere}/>}
    <p className="muted">About at every hour: choose their hours once they're added.</p>
  </Dialog>;
}
