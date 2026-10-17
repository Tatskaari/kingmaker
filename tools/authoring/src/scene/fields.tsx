// The scene editor's form fields. Each edits one value and reports a new one; typing in one field,
// from focus to blur, is one step of undo (the editor's EditSession). A field's label is its name and
// nothing more (its help is described-by), so an assistive tool, and a test, finds it by its name.
import React,{createContext,useContext,useEffect,useId,useState} from 'react';
import type {ReactNode} from 'react';
import {ArrowDown,ArrowUp,ExternalLink,Plus,Trash2,X} from 'lucide-react';

/** Typing in a field, from its focus to its blur, is one step of undo. */
export const EditSession=createContext<{onFocus:()=>void;onBlur:()=>void}>({onFocus:()=>{},onBlur:()=>{}});

type Common={label:string;hint?:ReactNode;field?:string};
type Ids={id:string;describedBy?:string};

/** A labelled field: the label, the control, and a line of help under it. */
function Field({label,hint,field,children}:Common&{children:(ids:Ids)=>ReactNode}){
  const id=useId(),hintId=useId();
  return <div className="field" data-field={field}>
    <label className="field-label" htmlFor={id}>{label}</label>
    {children({id,...(hint?{describedBy:hintId}:{})})}
    {hint&&<small id={hintId} className="field-hint">{hint}</small>}
  </div>;
}

export function TextField({label,hint,field,value,onChange,placeholder,readOnly,list}:Common&{value:string;onChange?:(value:string)=>void;placeholder?:string;readOnly?:boolean;list?:string}){
  const session=useContext(EditSession);
  return <Field label={label} hint={hint} field={field}>{({id,describedBy})=>
    <input {...session} id={id} aria-describedby={describedBy} value={value} placeholder={placeholder} readOnly={readOnly} list={list} onChange={event=>onChange?.(event.target.value)}/>
  }</Field>;
}

export function TextArea({label,hint,field,value,onChange,placeholder,rows=3}:Common&{value:string;onChange:(value:string)=>void;placeholder?:string;rows?:number}){
  const session=useContext(EditSession);
  return <Field label={label} hint={hint} field={field}>{({id,describedBy})=>
    <textarea {...session} id={id} aria-describedby={describedBy} rows={rows} value={value} placeholder={placeholder} onChange={event=>onChange(event.target.value)}/>
  }</Field>;
}

export type Option={value:string;label:string;detail?:string};

export function SelectField({label,hint,field,value,options,onChange}:Common&{value:string;options:Option[];onChange:(value:string)=>void}){
  const known=options.some(option=>option.value===value);
  return <Field label={label} hint={hint} field={field}>{({id,describedBy})=>
    <select id={id} aria-describedby={describedBy} value={value} onChange={event=>onChange(event.target.value)}>
      {!known&&<option value={value}>{value} (not one of these)</option>}
      {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  }</Field>;
}

/** A whole number: only a whole one is kept (an empty or half-typed field leaves the value as it was). */
export function NumberField({label,hint,field,value,onChange,min=0,max=40,disabled}:Common&{value:number;onChange:(value:number)=>void;min?:number;max?:number;disabled?:boolean}){
  const session=useContext(EditSession);
  const [text,setText]=useState(String(value));
  useEffect(()=>{if(Number(text)!==value)setText(String(value))},[value]);
  return <Field label={label} hint={hint} field={field}>{({id,describedBy})=>
    <input {...session} id={id} aria-describedby={describedBy} type="number" min={min} max={max} disabled={disabled} value={text} onChange={event=>{
      setText(event.target.value);
      const next=Number(event.target.value);
      if(event.target.value.trim()&&Number.isInteger(next))onChange(next);
    }}/>
  }</Field>;
}

export function Checkbox({label,hint,field,checked,onChange}:Common&{checked:boolean;onChange:(checked:boolean)=>void}){
  const hintId=useId();
  return <div className="check-field" data-field={field}>
    <label><input type="checkbox" aria-describedby={hint?hintId:undefined} checked={checked} onChange={event=>onChange(event.target.checked)}/><b>{label}</b></label>
    {hint&&<small id={hintId}>{hint}</small>}
  </div>;
}

/** Choose any of several: each a box, the chosen kept in the options' order. */
export function Checklist({label,hint,field,options,selected,onChange,empty}:Common&{options:Option[];selected:string[];onChange:(selected:string[])=>void;empty?:string}){
  const id=useId();
  const unknown=selected.filter(value=>!options.some(option=>option.value===value));
  const all=[...options,...unknown.map(value=>({value,label:`${value} (not in this scene)`} as Option))];
  const toggle=(value:string,on:boolean)=>{
    const next=new Set(on?[...selected,value]:selected.filter(item=>item!==value));
    onChange(all.map(option=>option.value).filter(item=>next.has(item)));
  };
  return <fieldset className="checklist" data-field={field} aria-labelledby={id}>
    <legend id={id} className="field-label">{label}</legend>
    {!all.length&&<p className="muted">{empty??'Nothing to choose yet.'}</p>}
    {all.map(option=><CheckOption key={option.value} option={option} checked={selected.includes(option.value)} onChange={on=>toggle(option.value,on)}/>)}
    {hint&&<small className="field-hint">{hint}</small>}
  </fieldset>;
}

function CheckOption({option,checked,onChange}:{option:Option;checked:boolean;onChange:(checked:boolean)=>void}){
  const detailId=useId();
  return <div className="check-field">
    <label><input type="checkbox" aria-describedby={option.detail?detailId:undefined} checked={checked} onChange={event=>onChange(event.target.checked)}/><b>{option.label}</b></label>
    {option.detail&&<small id={detailId}>{option.detail}</small>}
  </div>;
}

/** A list of texts, each its own box: add, remove, move up and down. */
export function ListField({label,hint,field,items,onChange,addLabel='Add',rows=2,placeholder}:Common&{items:string[];onChange:(items:string[])=>void;addLabel?:string;rows?:number;placeholder?:string}){
  const session=useContext(EditSession);
  const set=(index:number,value:string)=>onChange(items.map((item,i)=>i===index?value:item));
  const move=(index:number,by:number)=>{const next=[...items];const [item]=next.splice(index,1);next.splice(index+by,0,item);onChange(next)};
  return <fieldset className="list-field" data-field={field}>
    <legend className="field-label">{label}</legend>
    {items.map((item,index)=><div className="list-item" key={index}>
      <textarea {...session} aria-label={`${label} ${index+1}`} rows={rows} value={item} placeholder={placeholder} onChange={event=>set(index,event.target.value)}/>
      <div className="list-item-actions">
        <button type="button" title="Move up" aria-label={`Move ${label} ${index+1} up`} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={13}/></button>
        <button type="button" title="Move down" aria-label={`Move ${label} ${index+1} down`} disabled={index===items.length-1} onClick={()=>move(index,1)}><ArrowDown size={13}/></button>
        <button type="button" title="Remove" aria-label={`Remove ${label} ${index+1}`} onClick={()=>onChange(items.filter((_,i)=>i!==index))}><Trash2 size={13}/></button>
      </div>
    </div>)}
    <button type="button" className="add-item" onClick={()=>onChange([...items,''])}><Plus size={13}/>{addLabel}</button>
    {hint&&<small className="field-hint">{hint}</small>}
  </fieldset>;
}

/** A section of an inspector, open or closed. */
export function Section({title,children,open=true,count,field}:{title:string;children:ReactNode;open?:boolean;count?:number|string;field?:string}){
  return <details className="inspector-section" open={open} data-section={field}>
    <summary>{title}{count!==undefined&&<span className="count">{count}</span>}</summary>
    <div className="section-body">{children}</div>
  </details>;
}

/** Lore links: each a note of the campaign's lore/ (its name, and its path there), opened in the host or unlinked. */
export function LoreLinks({label,paths,names,onOpen,onUnlink,onAdd,addLabel='Link lore',hint,field}:{label:string;paths:string[];names:Map<string,string>;onOpen:(path:string)=>void;onUnlink:(path:string)=>void;onAdd:()=>void;addLabel?:string;hint?:ReactNode;field?:string}){
  return <div className="lore-links" data-field={field}>
    <span className="field-label">{label}</span>
    {!paths.length&&<p className="muted">None linked.</p>}
    {paths.map(path=><div className="lore-link" key={path}>
      <button type="button" className="lore-open" title={`Open lore/${path} in its own tab`} aria-label={`Open ${path}`} onClick={()=>onOpen(path)}><b>{names.get(path)??path.split('/').at(-1)}<ExternalLink size={11}/></b><small>{path}</small></button>
      <button type="button" title={`Unlink ${path}`} aria-label={`Unlink ${path}`} onClick={()=>onUnlink(path)}><X size={13}/></button>
    </div>)}
    <button type="button" className="add-item" onClick={onAdd}><Plus size={13}/>{addLabel}</button>
    {hint&&<small className="field-hint">{hint}</small>}
  </div>;
}
