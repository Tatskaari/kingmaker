import React,{useLayoutEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {X} from 'lucide-react';

/**
 * A small dialog in the file's view (not Obsidian's document body): Escape or the backdrop closes it,
 * Tab stays inside it, and focus goes back where it was when it closes.
 */
export function Dialog({label,title,onClose,children,footer,wide}:{label:string;title:string;onClose:()=>void;children:ReactNode;footer?:ReactNode;wide?:boolean}){
  const root=useRef<HTMLElement>(null),close=useRef(onClose);
  close.current=onClose;
  useLayoutEffect(()=>{
    const element=root.current;if(!element)return;
    const document=element.ownerDocument,previous=document.activeElement as HTMLElement|null;
    const first=element.querySelector<HTMLElement>('input:not([type=checkbox]):not([type=color]),select,textarea')??element.querySelector<HTMLElement>('button');
    first?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{
      if(!element.getClientRects().length||!element.contains(document.activeElement))return;
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();close.current();return}
      if(event.key!=='Tab')return;
      const controls=Array.from(element.querySelectorAll<HTMLElement>('button,input,select,textarea')).filter(control=>!control.matches(':disabled')&&control.getClientRects().length);
      const head=controls[0],tail=controls.at(-1);
      if(event.shiftKey&&document.activeElement===head||!event.shiftKey&&document.activeElement===tail){event.preventDefault();(event.shiftKey?tail:head)?.focus()}
    };
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);queueMicrotask(()=>{if(previous?.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true})})};
  },[]);
  return <div className="modal-backdrop" onPointerDown={event=>{event.stopPropagation();if(event.target===event.currentTarget)onClose()}} onKeyDown={event=>event.stopPropagation()}>
    <section ref={root} className={`modal km-dialog${wide?' wide':''}`} role="dialog" aria-modal="true" aria-label={label}>
      <header><h2>{title}</h2><button type="button" title="Close dialog" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></header>
      <div className="km-dialog-body">{children}</div>
      {footer&&<footer className="modal-footer">{footer}</footer>}
    </section>
  </div>;
}
