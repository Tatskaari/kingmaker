// What the scenario, map and place editors share of the scene editor's design (M3): under the file's
// title, a line with its problems and a bar of views, the document's own fields each in a view of the
// main area; an inspector beside the canvas that's only ever what's selected on it; lists as a list to
// pick from beside the chosen item's card, or as cards and chips, each removable, with a [+ Add …];
// and the uses of what's named elsewhere, each a link there.
import React,{useContext,useEffect,useId,useRef,useState} from 'react';
import {EditSession} from '../scene/fields.tsx';
import type {ReactNode} from 'react';
import {AlertTriangle,CheckCircle2,ExternalLink,Info,PanelRightClose,Plus,X} from 'lucide-react';
import {slugOf} from './json.ts';
import type {CampaignProblem} from './files.ts';

// ---------------------------------------------------------------------------------------------
// The views of a file, and the bar that switches them.

export type ViewTab<V extends string>={id:V;label:string;count?:number;bad?:boolean};

/** Each file's view, remembered while the plugin is loaded: an editor remade for the same file (a change made outside it, the file opened again) comes back to it. */
const remembered=new Map<string,string>();

/** The view of the file at `path`: the one it was last on, else `fallback`. */
export function useFileView<V extends string>(path:string,fallback:V,views:readonly V[]):[V,(view:V)=>void]{
  const [view,setState]=useState<V>(()=>{const old=remembered.get(path) as V|undefined;return old&&views.includes(old)?old:fallback});
  const setView=(next:V)=>{remembered.set(path,next);setState(next)};
  return [views.includes(view)?view:fallback,setView];
}

/**
 * The bar of views under a file's title: a tab list (Tab to it, then the arrow keys, Home and End),
 * each tab with its count, and the actions that go with the view on the right (undo, redo, a fit).
 */
export function ViewBar<V extends string>({ids,label,views,view,onView,actions}:{ids:string;label:string;views:ViewTab<V>[];view:V;onView:(view:V)=>void;actions?:ReactNode}){
  const bar=useRef<HTMLDivElement>(null);
  const keys=(event:React.KeyboardEvent)=>{
    const at=views.findIndex(tab=>tab.id===view),last=views.length-1;
    const to=event.key==='ArrowRight'?(at+1)%views.length:event.key==='ArrowLeft'?(at+last)%views.length:event.key==='Home'?0:event.key==='End'?last:-1;
    if(to<0)return;
    event.preventDefault();event.stopPropagation();
    onView(views[to].id);
    bar.current?.querySelector<HTMLElement>(`[data-view="${views[to].id}"]`)?.focus();
  };
  return <div className="view-bar" ref={bar}>
    <div className="view-tabs" role="tablist" aria-label={label} onKeyDown={keys}>
      {views.map(tab=><button key={tab.id} type="button" role="tab" data-view={tab.id} id={`${ids}-tab-${tab.id}`} aria-controls={`${ids}-view`} aria-selected={view===tab.id} tabIndex={view===tab.id?0:-1}
        aria-label={tab.count===undefined?tab.label:`${tab.label} (${tab.count})`} className={view===tab.id?'active':''} onClick={()=>onView(tab.id)}>
        {tab.label}{tab.count!==undefined&&<span className={`count${tab.bad&&tab.count?' bad':''}`}>{tab.count}</span>}
      </button>)}
    </div>
    {actions&&<div className="view-actions">{actions}</div>}
  </div>;
}

/** The main area under the bar: the view's own panel. */
export function ViewArea({ids,view,children}:{ids:string;view:string;children:ReactNode}){
  return <div className={`view-area view-${view}`} role="tabpanel" id={`${ids}-view`} aria-labelledby={`${ids}-tab-${view}`}>{children}</div>;
}

/** A file's title: what kind of file it is and its id over its title, and under it how many problems it has (a button that opens them). */
export function DocHeading({kind,id,title,problems,checking,onProblems,children}:{kind:string;id:string;title:string;problems:number;checking:boolean;onProblems:()=>void;children?:ReactNode}){
  return <div className="canvas-heading doc-heading">
    <div className="doc-title">
      <div className="eyebrow">KINGMAKER · {kind.toUpperCase()} · <code>{id}</code></div>
      <h1>{title||id}</h1>
      <button type="button" className={`problems-link${problems?' has-problems':''}`} onClick={onProblems}>
        {checking?'Checking…':problems?<><AlertTriangle size={13}/>{problems} problem{problems===1?'':'s'}</>:<><CheckCircle2 size={13}/>No problems</>}
      </button>
    </div>
    {children}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// The inspector: what's selected, and nothing else.

/**
 * The inspector beside a canvas: what's selected on it (its kind in the header), or a hint when
 * nothing is. In a narrow pane it lies over the canvas's right side, only while something is selected.
 */
export function Inspector({what,empty,onClose,children,className}:{what:ReactNode;empty:boolean;onClose?:()=>void;children:ReactNode;className?:string}){
  return <aside className={`inspector doc-inspector${empty?' empty':''}${className?` ${className}`:''}`} aria-label="Inspector">
    <header className="inspector-top">
      <span className="inspector-what">{what}</span>
      {onClose&&!empty&&<button type="button" title="Close: select nothing" aria-label="Close the inspector" onClick={onClose}><PanelRightClose size={15}/></button>}
    </header>
    <div className="inspector-body">{children}</div>
  </aside>;
}

// ---------------------------------------------------------------------------------------------
// A list beside the chosen item's card (the scene editor's Cast view): the regions of a map, its
// people, a place's things.

export type ListItem={id:string;label:ReactNode;detail?:ReactNode;note?:ReactNode;swatch?:ReactNode};

/** A view of a list: its items to pick from (the first when none is chosen), the chosen one's card beside them, and a [+ Add …] under the list. */
export function ListView({title,label,items,chosen,onChoose,add,card,empty,filter,className}:{title:string;label:string;items:ListItem[];chosen?:string;onChoose:(id:string)=>void;add?:ReactNode;card:ReactNode;empty:string;filter?:ReactNode;className?:string}){
  return <div className={`view-content list-view${className?` ${className}`:''}`}>
    <aside className="pick-list" aria-label={label}>
      <h2 className="group-title">{title}<span className="count">{items.length}</span></h2>
      {filter}
      {!items.length&&<p className="muted">{empty}</p>}
      <ul>
        {items.map(item=><li key={item.id}>
          <button type="button" className={`list-pick${chosen===item.id?' active':''}`} aria-current={chosen===item.id||undefined} data-pick={item.id} onClick={()=>onChoose(item.id)}>
            {item.swatch}<span><b>{item.label}</b>{item.detail&&<small>{item.detail}</small>}{item.note&&<small>{item.note}</small>}</span>
          </button>
        </li>)}
      </ul>
      {add}
    </aside>
    {card}
  </div>;
}

/** A card of the main area: a heading, its fields, and its actions. */
export function DocCard({title,kind,badge,actions,children,label,data}:{title:ReactNode;kind?:ReactNode;badge?:ReactNode;actions?:ReactNode;children:ReactNode;label:string;data?:Record<string,string>}){
  return <section className="doc-card" aria-label={label} {...Object.fromEntries(Object.entries(data??{}).map(([k,v])=>[`data-${k}`,v]))}>
    <header className="doc-card-head">
      <div>{kind&&<p className="inspector-kind">{kind}</p>}<h2>{title}</h2>{badge}</div>
      {actions&&<div className="doc-card-actions">{actions}</div>}
    </header>
    {children}
  </section>;
}

// ---------------------------------------------------------------------------------------------
// Uses: where something is named, each a link there.

export type Use={key:string;label:ReactNode;detail?:ReactNode;onOpen?:()=>void};

/** Where something is used or named, as links: "Played at", "Named by"… With none, what that means. */
export function Uses({title,uses,none,field}:{title:string;uses:Use[];none:string;field?:string}){
  return <div className="uses" data-field={field}>
    <span className="field-label">{title}</span>
    {!uses.length&&<p className="muted">{none}</p>}
    {uses.length>0&&<ul>
      {uses.map(use=><li key={use.key}>{use.onOpen?<button type="button" className="use-link" onClick={use.onOpen}><span>{use.label}</span>{use.detail&&<small>{use.detail}</small>}</button>:<span className="use-text">{use.label}{use.detail&&<small>{use.detail}</small>}</span>}</li>)}
    </ul>}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Short words as chips (a thing's states and tags, a decor's): each removable, and a new one typed in.

export function WordChips({label,words,onChange,addLabel,hint,field,placeholder}:{label:string;words:string[];onChange:(words:string[])=>void;addLabel:string;hint?:ReactNode;field?:string;placeholder?:string}){
  const [adding,setAdding]=useState(false),[word,setWord]=useState('');
  const input=useId();
  const add=()=>{const next=word.trim();if(next&&!words.includes(next))onChange([...words,next]);setWord('')};
  return <div className="word-chips" data-field={field}>
    <span className="field-label">{label}</span>
    {words.length>0&&<ul className="chips" aria-label={label}>
      {words.map(item=><li className="chip" key={item}><span>{item}</span><button type="button" className="chip-remove" aria-label={`Remove ${item}`} title={`Remove ${item}`} onClick={()=>onChange(words.filter(other=>other!==item))}><X size={12}/></button></li>)}
    </ul>}
    {adding?<div className="chip-new" data-own-escape onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setAdding(false);setWord('')}}}>
      <input id={input} autoFocus aria-label={`New: ${label}`} value={word} placeholder={placeholder} onChange={event=>setWord(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add()}}}/>
      <button type="button" disabled={!word.trim()} onClick={add}>Add</button>
      <button type="button" className="icon-button" aria-label="Done" title="Done (Esc)" onClick={()=>{add();setAdding(false)}}><X size={13}/></button>
    </div>:<button type="button" className="add-item" onClick={()=>setAdding(true)}><Plus size={13}/>{addLabel}</button>}
    {hint&&<small className="field-hint">{hint}</small>}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Keys the format doesn't know (a migrated region's script notes): kept where they are, shown, edited
// when they're text, and taken out.

export function OtherKeys({value,known,onChange,label='Other keys'}:{value:object;known:readonly string[];onChange:(key:string,value:unknown)=>void;label?:string}){
  const session=useContext(EditSession);
  const others=Object.entries(value).filter(([key])=>!known.includes(key));
  if(!others.length)return null;
  return <fieldset className="other-keys" data-field="other">
    <legend className="field-label">{label}</legend>
    <small className="field-hint">Keys the format doesn't have, kept as they are (the game doesn't read them).</small>
    {others.map(([key,item])=><div className="other-key" key={key} data-field={key}>
      <div className="other-key-head"><code>{key}</code><button type="button" className="icon-button" aria-label={`Remove ${key}`} title={`Take ${key} out`} onClick={()=>onChange(key,undefined)}><X size={13}/></button></div>
      {typeof item==='string'?<textarea {...session} aria-label={key} value={item} rows={2} onChange={event=>onChange(key,event.target.value)}/>:<pre>{JSON.stringify(item,null,2)}</pre>}
    </div>)}
  </fieldset>;
}

// ---------------------------------------------------------------------------------------------
// A new file of the campaign, made where it's picked.

/** The kinds of file an editor can make and list: a scene, a map or a place. */
export type NewKind='scene'|'map'|'place';
const FOLDERS:Record<NewKind,string>={scene:'scenes',map:'maps',place:'places'};
const EXTENSIONS:Record<NewKind,string>={scene:'kmscene',map:'kmmap',place:'kmplace'};

/** The form for a new file: its title, its file named for the slug of it (its id), and Make. */
export function NewFileForm({kind,onCreate,taken=[],hint,onDone}:{kind:NewKind;onCreate:(title:string,id:string)=>void;taken?:string[];hint?:ReactNode;onDone?:()=>void}){
  const [title,setTitle]=useState('');
  const field=useId();
  const id=slugOf(title),clash=!!id&&taken.includes(id);
  const make=()=>{if(!id||clash)return;onCreate(title.trim(),id);setTitle('');onDone?.()};
  return <div className="new-file-form">
    <label className="field-label" htmlFor={field}>{`New ${kind}: its title`}</label>
    <input id={field} autoFocus value={title} placeholder={kind==='scene'?'The Lamplighter':kind==='map'?'Chandler Row':'The chandler\'s shop'} onChange={event=>setTitle(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();make()}}}/>
    <small className="field-hint">{clash?`There's a ${kind} file ${id} already: give it another title.`:id?`${FOLDERS[kind]}/${id}.${EXTENSIONS[kind]}, listed in the scenario.`:'Its file is named for the slug of its title, which is its id.'}{hint?<> {hint}</>:null}</small>
    <button type="button" className="primary" disabled={!id||clash} onClick={make}><Plus size={13}/>Make the {kind}</button>
  </div>;
}

/**
 * [+ New scene] (or map, or place) where one is picked: its title asked for in place, its file named
 * for the slug of it (its id), made and listed in the scenario, and picked, as one step of undo.
 */
export function NewFile({kind,label,onCreate,taken=[],hint}:{kind:NewKind;label?:string;onCreate:(title:string,id:string)=>void;taken?:string[];hint?:ReactNode}){
  const [open,setOpen]=useState(false);
  const close=()=>setOpen(false);
  if(!open)return <button type="button" className="text-button new-file-button" onClick={()=>setOpen(true)}><Plus size={12}/>{label??`New ${kind}`}</button>;
  return <div className="add-picker new-file-inline" role="group" aria-label={label??`New ${kind}`} data-own-escape onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}}}>
    <header><b>{label??`New ${kind}`}</b><button type="button" className="icon-button" aria-label="Cancel" title="Cancel (Esc)" onClick={close}><X size={13}/></button></header>
    <NewFileForm kind={kind} onCreate={onCreate} taken={taken} hint={hint} onDone={close}/>
  </div>;
}

// ---------------------------------------------------------------------------------------------
// The Problems view of a file of the campaign.

/**
 * The campaign check's problems for the file (and what it shows of another), each taking the author to
 * where it is, with the notes on the file itself (not one of the scenario's, named for another id) above them.
 */
export function ProblemsList({lede,problems,notes,checking,clear,onGo,where}:{lede:ReactNode;problems:CampaignProblem[];notes:string[];checking:boolean;clear:string;onGo:(problem:CampaignProblem)=>void;where?:(problem:CampaignProblem)=>string}){
  return <div className="view-content problems-view">
    <header className="view-header"><h2>Problems</h2><p className="view-lede">{lede}</p></header>
    {notes.map(note=><p className="problems-note" key={note}><Info size={14}/>{note}</p>)}
    {!checking&&(problems.length?<p className="muted">The campaign check would refuse the campaign for {problems.length===1?'this':`these ${problems.length}`}. Each takes you to where it is.</p>:<p className="problems-clear"><CheckCircle2 size={15}/>{clear}</p>)}
    <ol className="problems">{problems.map((problem,index)=><li key={`${index}:${problem.message}`}>
      <button type="button" className="problem" onClick={()=>onGo(problem)}><AlertTriangle size={14}/><span><b>{problem.message}</b><small>{where?.(problem)??problem.file}</small></span></button>
    </li>)}</ol>
  </div>;
}

/** An open-in-its-tab link to a file of the campaign. */
export function OpenLink({path,label,onOpen}:{path:string;label?:string;onOpen:(path:string)=>void}){
  return <button type="button" className="text-button open-link" title={`Open ${path} in its own tab`} onClick={()=>onOpen(path)}>{label??`Open ${path}`}<ExternalLink size={11}/></button>;
}

/** A group's links at the top of a long view: each scrolls to its group. */
export function ViewIndex({label,groups}:{label:string;groups:Array<[string,string]>}){
  return <nav className="view-index" aria-label={label}>
    {groups.map(([anchor,title])=><button type="button" key={anchor} onClick={event=>event.currentTarget.closest('.view-content')?.querySelector(`[data-anchor="${anchor}"]`)?.scrollIntoView({block:'start',behavior:'smooth'})}>{title}</button>)}
  </nav>;
}

/** The element for a dot path of fields ("exits.2.label") under `root`: the longest part of it marked as one field, then the rest inside that. */
export function findField(root:Element,path:string):HTMLElement|null{
  const parts=path.split('.');
  for(let length=parts.length;length>0;length--){
    const element=root.querySelector<HTMLElement>(`[data-field="${CSS.escape(parts.slice(0,length).join('.'))}"],[data-section="${CSS.escape(parts.slice(0,length).join('.'))}"]`);
    if(!element)continue;
    return length===parts.length?element:findField(element,parts.slice(length).join('.'))??element;
  }
  return null;
}

/** Show a part of a view: open what it's in, scroll to it, focus its first control, and mark it a moment. */
export function reveal(element:HTMLElement,focus=true){
  for(let open=element.closest('details');open;open=open.parentElement?.closest('details')??null)open.setAttribute('open','');
  element.scrollIntoView({block:'center'});
  if(focus){
    const control=element.matches('input,textarea,select,button')?element:element.querySelector<HTMLElement>('input:not([type=hidden]):not([readonly]):not(:disabled),textarea,select:not(:disabled),button:not(:disabled)');
    control?.focus({preventScroll:true});
  }
  element.classList.add('flash');
  window.setTimeout(()=>element.classList.remove('flash'),1400);
}

/** Once the view's drawn, the field at `path` (a dot path) under `root`'s `within` revealed: tried each frame for a third of a second. */
export function revealSoon(root:HTMLElement|null,path:string,within='.view-area'){
  let tries=0;
  const attempt=()=>{
    const area=root?.querySelector(within);
    const element=area?findField(area,path):null;
    if(element){reveal(element);return}
    if(++tries<20)requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

/** Text shown as a few words: what a hint or a count says of a list. */
export const plural=(count:number,one:string,many=`${one}s`)=>`${count} ${count===1?one:many}`;

/** Whether the editor's own pane is narrow (the narrow layout's breakpoint, 760px), as the container query has it. */
export function useNarrow(element:React.RefObject<HTMLElement|null>,width=760):boolean{
  const [narrow,setNarrow]=useState(false);
  useEffect(()=>{
    const node=element.current;if(!node)return;
    const observer=new ResizeObserver(()=>setNarrow(node.clientWidth<=width));
    observer.observe(node);
    return()=>observer.disconnect();
  },[element,width]);
  return narrow;
}
