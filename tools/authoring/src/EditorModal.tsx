import {useLayoutEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import {X} from 'lucide-react';

type EditorModalProps={label:string;title:string;onClose:()=>void;children:ReactNode;suspended?:boolean};

const focusableSelector='button, a[href], input:not([type="hidden"]), textarea, select, [tabindex], [contenteditable="true"]';
const canFocus=(element:Element|null):element is HTMLElement=>!!element&&typeof (element as HTMLElement).focus==='function';
const focusableElements=(root:HTMLElement)=>Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(element=>
  element.tabIndex>=0&&!element.matches(':disabled')&&!element.closest('[hidden], [aria-hidden="true"], [inert]')&&element.getClientRects().length>0
);

/** A local editor overlay: it stays in the file view, not in Obsidian's document body. */
export function EditorModal({label,title,onClose,children,suspended=false}:EditorModalProps){
  const dialog=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const close=useRef(onClose),resumeFocus=useRef<HTMLElement|null>(null);
  close.current=onClose;

  // Capture once so intermediate renders or a nested picker do not change the return target.
  useLayoutEffect(()=>{
    const element=dialog.current;if(!element)return;
    const previous=element.ownerDocument.activeElement;
    return()=>{if(canFocus(previous)&&previous.isConnected)previous.focus({preventScroll:true})};
  },[]);

  useLayoutEffect(()=>{
    const element=dialog.current;if(!element||suspended)return;
    const document=element.ownerDocument;
    const targets=focusableElements(element);
    const initial=resumeFocus.current&&targets.includes(resumeFocus.current)?resumeFocus.current:
      targets.find(target=>target.matches('input, textarea'))??closeButton.current??element;
    initial.focus({preventScroll:true});

    const onFocus=(event:FocusEvent)=>{
      const target=event.target as Element|null;
      if(canFocus(target)&&element.contains(target))resumeFocus.current=target;
    };
    const onKey=(event:KeyboardEvent)=>{
      // File views can stay mounted in inactive tabs or beside another focused split.
      // Their local editor must not intercept shortcuts from the rest of Obsidian.
      if(!element.getClientRects().length||!element.contains(document.activeElement))return;
      if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation();close.current();return;
      }
      if(event.key!=='Tab')return;
      const targets=focusableElements(element),active=document.activeElement;
      const first=targets[0]??element,last=targets.at(-1)??element;
      if(!targets.length||!element.contains(active)||event.shiftKey&&active===first||!event.shiftKey&&active===last){
        event.preventDefault();event.stopPropagation();
        (event.shiftKey?last:first).focus({preventScroll:true});
      }
    };
    document.addEventListener('focusin',onFocus,true);
    document.addEventListener('keydown',onKey,true);
    return()=>{
      document.removeEventListener('focusin',onFocus,true);
      document.removeEventListener('keydown',onKey,true);
    };
  },[suspended]);

  const closeLabel=label==='Edit node'?'Close node editor':'Close transitions editor';
  return <div className="modal-backdrop editor-backdrop" onPointerDown={event=>{
    event.stopPropagation();
    if(event.target===event.currentTarget&&!suspended)close.current();
  }} onClick={event=>event.stopPropagation()}>
    <section ref={dialog} className="modal expanded-editor" role="dialog" aria-modal="true" aria-label={label} aria-hidden={suspended||undefined} inert={suspended||undefined} tabIndex={-1}>
      <header><h2>{title}</h2><button ref={closeButton} title={closeLabel} aria-label={closeLabel} onClick={()=>close.current()}><X size={19}/></button></header>
      <div className="editor-modal-content">{children}</div>
      <footer className="editor-modal-footer"><span>Changes autosave to this file.</span><button onClick={()=>close.current()}>Done</button></footer>
    </section>
  </div>;
}
