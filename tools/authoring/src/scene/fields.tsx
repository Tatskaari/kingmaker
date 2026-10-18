// The scene editor's form fields. Each edits one value and reports a new one; typing in one field,
// from focus to blur, is one step of undo (the editor's EditSession). A field's label is its name and
// nothing more (its help is described-by), so an assistive tool, and a test, finds it by its name.
// The lists follow one pattern: what's there as cards or chips, each removable, and a [+ Add …] that
// opens a short list to pick from (and, where it makes sense, a way to make a new one).
import React,{createContext,useContext,useEffect,useId,useRef,useState} from 'react';
import type {CSSProperties,ReactNode} from 'react';
import {ArrowDown,ArrowUp,Check,ExternalLink,Pencil,Plus,Search,Trash2,X} from 'lucide-react';

/** Typing in a field, from its focus to its blur, is one step of undo. */
export const EditSession=createContext<{onFocus:()=>void;onBlur:()=>void}>({onFocus:()=>{},onBlur:()=>{}});

type Common={label:string;hint?:ReactNode;field?:string};
type Ids={id:string;describedBy?:string};

/** A labelled field: the label (kept for assistive tools but not shown when `hideLabel`, as in a section that's titled already), the control, and a line of help under it. */
function Field({label,hint,field,children,className,hideLabel}:Common&{children:(ids:Ids)=>ReactNode;className?:string;hideLabel?:boolean}){
  const id=useId(),hintId=useId();
  return <div className={`field${className?` ${className}`:''}`} data-field={field}>
    <label className={`field-label${hideLabel?' sr-only':''}`} htmlFor={id}>{label}</label>
    {children({id,...(hint?{describedBy:hintId}:{})})}
    {hint&&<small id={hintId} className="field-hint">{hint}</small>}
  </div>;
}

export function TextField({label,hint,field,value,onChange,placeholder,readOnly,list,autoFocus}:Common&{value:string;onChange?:(value:string)=>void;placeholder?:string;readOnly?:boolean;list?:string;autoFocus?:boolean}){
  const session=useContext(EditSession);
  return <Field label={label} hint={hint} field={field}>{({id,describedBy})=>
    <input {...session} id={id} aria-describedby={describedBy} value={value} placeholder={placeholder} readOnly={readOnly} list={list} autoFocus={autoFocus} onChange={event=>onChange?.(event.target.value)}/>
  }</Field>;
}

/**
 * A text that grows with what's written in it (no box to scroll inside). `onLeave` runs as the field
 * loses focus, before the step of undo closes: an optional text left empty is taken out then, so its
 * section doesn't vanish while it's being retyped.
 */
export function TextArea({label,hint,field,value,onChange,onLeave,placeholder,rows=3,autoFocus,hideLabel}:Common&{value:string;onChange:(value:string)=>void;onLeave?:(value:string)=>void;placeholder?:string;rows?:number;autoFocus?:boolean;hideLabel?:boolean}){
  const session=useContext(EditSession);
  return <Field label={label} hint={hint} field={field} hideLabel={hideLabel}>{({id,describedBy})=>
    <textarea onFocus={session.onFocus} onBlur={event=>{onLeave?.(event.target.value);session.onBlur()}} id={id} aria-describedby={describedBy} rows={rows} style={{'--rows':rows} as CSSProperties} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={event=>onChange(event.target.value)}/>
  }</Field>;
}

export type Option={value:string;label:string;detail?:string};

export function SelectField({label,hint,field,value,options,onChange,placeholder}:Common&{value:string;options:Option[];onChange:(value:string)=>void;placeholder?:string}){
  const known=options.some(option=>option.value===value);
  return <Field label={label} hint={hint} field={field}>{({id,describedBy})=>
    <select id={id} aria-describedby={describedBy} value={value} onChange={event=>onChange(event.target.value)}>
      {!known&&<option value={value} disabled={value===''&&!!placeholder}>{value===''&&placeholder?placeholder:`${value} (not one of these)`}</option>}
      {options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  }</Field>;
}

/** A whole number: only a whole one is kept (an empty or half-typed field leaves the value as it was, or, when it's optional, takes it out: only then is undefined reported). */
type NumberChange={optional?:false;onChange:(value:number)=>void}|{optional:true;onChange:(value:number|undefined)=>void};
export function NumberField({label,hint,field,value,onChange,min=0,max=40,disabled,optional}:Common&{value:number|undefined;min?:number;max?:number;disabled?:boolean}&NumberChange){
  const session=useContext(EditSession);
  const [text,setText]=useState(value===undefined?'':String(value));
  useEffect(()=>{if((text.trim()===''?undefined:Number(text))!==value)setText(value===undefined?'':String(value))},[value]);
  return <Field label={label} hint={hint} field={field}>{({id,describedBy})=>
    <input {...session} id={id} aria-describedby={describedBy} type="number" min={min} max={max} disabled={disabled} value={text} onChange={event=>{
      setText(event.target.value);
      const next=Number(event.target.value);
      if(event.target.value.trim()&&Number.isInteger(next))onChange(next);
      else if(optional&&!event.target.value.trim())onChange(undefined);
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

/**
 * One of a few, side by side: each a radio, the chosen one marked, with a line under them on what the
 * chosen one means. `tone` colours an option (an ending's good, mixed and bad).
 */
export function ChoiceField({label,hint,field,value,options,onChange}:Common&{value:string;options:Array<Option&{tone?:string}>;onChange:(value:string)=>void}){
  const name=useId(),legend=useId();
  const chosen=options.find(option=>option.value===value);
  return <fieldset className="choice-field" data-field={field} aria-labelledby={legend}>
    <legend id={legend} className="field-label">{label}</legend>
    <div className="segments">
      {options.map(option=><label key={option.value} className={`segment${option.tone?` ${option.tone}`:''}${option.value===value?' on':''}`} title={option.detail}>
        <input type="radio" name={name} value={option.value} checked={option.value===value} onChange={()=>onChange(option.value)}/>
        <span>{option.label}</span>
      </label>)}
    </div>
    {chosen?.detail&&<small className="choice-detail">{chosen.detail}</small>}
    {!chosen&&<small className="choice-detail">{value} isn't one of these.</small>}
    {hint&&<small className="field-hint">{hint}</small>}
  </fieldset>;
}

/**
 * A [+ Add …] button that opens a short list to pick from in place: each option a button (its name, and
 * a line on it), a search when the list is long, and, when `children` is given, a way to make a new one
 * under the list. Picking closes it; Escape or × closes it and returns to the button.
 */
export function AddPicker({label,title,options,onPick,empty,children,disabled}:{label:string;title?:string;options:Option[];onPick:(value:string)=>void;empty?:string;children?:(close:()=>void)=>ReactNode;disabled?:boolean}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),returning=useRef(false);
  const close=()=>{returning.current=true;setOpen(false);setQuery('')};
  useEffect(()=>{
    if(open){panel.current?.querySelector<HTMLElement>('input,.pick-option,textarea')?.focus({preventScroll:true});panel.current?.scrollIntoView({block:'nearest'})}
    else if(returning.current){
      // Back to the button, unless what was picked took the focus (a new role's text, say).
      returning.current=false;
      const active=button.current?.ownerDocument.activeElement;
      if(!active||active===active.ownerDocument.body||!active.isConnected)button.current?.focus({preventScroll:true});
    }
  },[open]);
  if(!open)return <button ref={button} type="button" className="add-item" disabled={disabled} onClick={()=>setOpen(true)}><Plus size={13}/>{label}</button>;
  const words=query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown=options.filter(option=>words.every(word=>`${option.label} ${option.value} ${option.detail??''}`.toLowerCase().includes(word)));
  return <div className="add-picker" ref={panel} role="group" aria-label={title??label} data-own-escape onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}}}>
    <header><b>{title??label}</b><button type="button" className="icon-button" aria-label="Cancel" title="Cancel (Esc)" onClick={close}><X size={13}/></button></header>
    {options.length>6&&<div className="pick-search"><Search size={13}/><input type="search" aria-label={`Search: ${title??label}`} placeholder="Search…" value={query} onChange={event=>setQuery(event.target.value)}/></div>}
    {options.length>0&&<div className="pick-options">
      {shown.map(option=><button type="button" className="pick-option" key={option.value} onClick={()=>{onPick(option.value);close()}}><b>{option.label}</b>{option.detail&&<small>{option.detail}</small>}</button>)}
      {!shown.length&&<p className="muted">Nothing matches.</p>}
    </div>}
    {!options.length&&empty&&<p className="muted">{empty}</p>}
    {children?.(close)}
  </div>;
}

/** Things chosen, as chips: each named, removable, and opened when it can be. */
export function Chips({label,items,onRemove,empty}:{label:string;items:Array<{value:string;label:string;detail?:string;onOpen?:()=>void}>;onRemove:(value:string)=>void;empty?:string}){
  if(!items.length)return empty?<p className="muted chips-empty">{empty}</p>:null;
  return <ul className="chips" aria-label={label}>
    {items.map(item=><li className="chip" key={item.value} title={item.detail}>
      {item.onOpen?<button type="button" className="chip-open" onClick={item.onOpen}>{item.label}</button>:<span>{item.label}</span>}
      <button type="button" className="chip-remove" aria-label={`Remove ${item.label}`} title={`Remove ${item.label}`} onClick={()=>onRemove(item.value)}><X size={12}/></button>
    </li>)}
  </ul>;
}

/**
 * A part that's optional in the format: a [+ Add …] button while it isn't there, a section with its
 * fields and a remove button when it is. `onAdd` writes what adding it means (when adding it writes
 * nothing until something is typed, it's left out, and the section stays open meanwhile).
 */
export function OptionalSection({title,field,present,addLabel,hint,onAdd,onRemove,children,className}:{title:string;field?:string;present:boolean;addLabel:string;hint?:ReactNode;onAdd?:()=>void;onRemove:()=>void;children:ReactNode|((close:()=>void)=>ReactNode);className?:string}){
  const [opened,setOpened]=useState(false),[focusing,setFocusing]=useState(false);
  const section=useRef<HTMLElement>(null);
  const close=()=>setOpened(false);
  useEffect(()=>{if(!focusing)return;setFocusing(false);section.current?.querySelector<HTMLElement>('textarea,input,select')?.focus()},[focusing]);
  if(!present&&!opened)return <div className={`optional-add${className?` ${className}`:''}`} data-field={field}>
    <button type="button" className="add-item" onClick={()=>{onAdd?.();setOpened(true);setFocusing(true)}}><Plus size={13}/>{addLabel}</button>
    {hint&&<small className="field-hint">{hint}</small>}
  </div>;
  return <section ref={section} className={`optional-section${className?` ${className}`:''}`} data-field={field} aria-label={title}>
    <header><span className="field-label">{title}</span><button type="button" className="icon-button" aria-label={`Remove ${title.toLowerCase()}`} title={`Remove ${title.toLowerCase()}`} onClick={()=>{onRemove();close()}}><Trash2 size={13}/></button></header>
    {typeof children==='function'?children(close):children}
  </section>;
}

/** A card in a list: its number, a title, and buttons to move it up or down and to remove it. */
export function ItemCard({index,count,title,badges,label,onMove,onRemove,removeLabel,children,field,className}:{index:number;count:number;title:ReactNode;badges?:ReactNode;label:string;onMove?:(by:number)=>void;onRemove:()=>void;removeLabel:string;children:ReactNode;field?:string;className?:string}){
  return <article className={`item-card${className?` ${className}`:''}`} aria-label={label} data-field={field}>
    <header>
      <span className="item-number">{index+1}</span><b>{title}</b>{badges}
      <span className="item-actions">
        {onMove&&<button type="button" title="Move up" aria-label={`Move ${label} up`} disabled={index===0} onClick={()=>onMove(-1)}><ArrowUp size={13}/></button>}
        {onMove&&<button type="button" title="Move down" aria-label={`Move ${label} down`} disabled={index===count-1} onClick={()=>onMove(1)}><ArrowDown size={13}/></button>}
        <button type="button" title={removeLabel} aria-label={`${removeLabel} ${index+1}`} onClick={onRemove}><Trash2 size={13}/></button>
      </span>
    </header>
    {children}
  </article>;
}

/** A list moved: the item at `index` by `by` places. */
export function moved<T>(items:T[],index:number,by:number):T[]{
  const next=[...items];const [item]=next.splice(index,1);next.splice(index+by,0,item);return next;
}

/**
 * An id, shown, and renamed only by asking: [Rename] opens a field for the new one (a slug, not taken),
 * with what renaming does. Game state keys on ids, so the warning says so.
 */
export function IdField({id,label='Id',problem,onRename,warning,field='id'}:{id:string;label?:string;problem:(id:string)=>string|undefined;onRename:(id:string)=>void;warning?:ReactNode;field?:string}){
  const [editing,setEditing]=useState(false),[value,setValue]=useState(id);
  const input=useId(),hint=useId();
  const wrong=value===id?undefined:problem(value);
  const done=()=>{setEditing(false);setValue(id)};
  const rename=()=>{if(value===id||wrong)return;onRename(value);setEditing(false)};
  if(!editing)return <div className="id-field" data-field={field}>
    <span className="field-label">{label}</span><code>{id}</code>
    <button type="button" className="text-button" aria-label={`Rename ${label.toLowerCase()} ${id}`} onClick={()=>{setValue(id);setEditing(true)}}><Pencil size={11}/>Rename</button>
  </div>;
  return <div className="id-field editing" data-field={field} data-own-escape onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();done()}}}>
    <label className="field-label" htmlFor={input}>New {label.toLowerCase()}</label>
    <div className="id-rename">
      <input id={input} autoFocus aria-describedby={hint} aria-invalid={!!wrong} value={value} spellCheck={false} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();rename()}}}/>
      <button type="button" className="primary" disabled={value===id||!!wrong} onClick={rename}><Check size={13}/>Rename</button>
      <button type="button" onClick={done}>Cancel</button>
    </div>
    <small id={hint} className={wrong?'json-problem':'field-hint'}>{wrong??warning}</small>
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
  const [focus,setFocus]=useState<number|null>(null);
  const list=useRef<HTMLFieldSetElement>(null);
  useEffect(()=>{if(focus===null)return;list.current?.querySelectorAll<HTMLTextAreaElement>('textarea')[focus]?.focus();setFocus(null)},[focus]);
  const set=(index:number,value:string)=>onChange(items.map((item,i)=>i===index?value:item));
  return <fieldset className="list-field" data-field={field} ref={list}>
    <legend className="field-label">{label}</legend>
    {items.map((item,index)=><div className="list-item" key={index} data-field={String(index)}>
      <textarea {...session} aria-label={`${label} ${index+1}`} rows={rows} style={{'--rows':rows} as CSSProperties} value={item} placeholder={placeholder} onChange={event=>set(index,event.target.value)}/>
      <div className="list-item-actions">
        <button type="button" title="Move up" aria-label={`Move ${label} ${index+1} up`} disabled={index===0} onClick={()=>onChange(moved(items,index,-1))}><ArrowUp size={13}/></button>
        <button type="button" title="Move down" aria-label={`Move ${label} ${index+1} down`} disabled={index===items.length-1} onClick={()=>onChange(moved(items,index,1))}><ArrowDown size={13}/></button>
        <button type="button" title="Remove" aria-label={`Remove ${label} ${index+1}`} onClick={()=>onChange(items.filter((_,i)=>i!==index))}><Trash2 size={13}/></button>
      </div>
    </div>)}
    <button type="button" className="add-item" onClick={()=>{onChange([...items,'']);setFocus(items.length)}}><Plus size={13}/>{addLabel}</button>
    {hint&&<small className="field-hint">{hint}</small>}
  </fieldset>;
}

/** A group of fields under a heading, in a view or an inspector. */
export function Group({title,children,field,hint,anchor}:{title:string;children:ReactNode;field?:string;hint?:ReactNode;anchor?:string}){
  return <section className="field-group" data-section={field} data-anchor={anchor} aria-label={title}>
    <h2 className="group-title">{title}</h2>
    {hint&&<p className="group-hint">{hint}</p>}
    {children}
  </section>;
}

/** A section of an inspector, open or closed, with a count: the scenario editor's inspector (M4) keeps these, where the scene editor's views have groups. */
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
