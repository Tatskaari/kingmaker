import {useId,useLayoutEffect,useRef} from 'react';

type ConfirmDialogProps={title:string;description:string;confirmLabel:string;onConfirm:()=>void;onCancel:()=>void;returnFocus?:HTMLElement|null;fallbackFocus?:HTMLElement|null};

/** Destructive actions require an explicit choice; opening this dialog focuses Cancel. */
export function ConfirmDialog({title,description,confirmLabel,onConfirm,onCancel,returnFocus,fallbackFocus}:ConfirmDialogProps){
  const id=useId(),dialog=useRef<HTMLElement>(null),cancelButton=useRef<HTMLButtonElement>(null);
  const cancel=useRef(onCancel);cancel.current=onCancel;

  useLayoutEffect(()=>{
    const element=dialog.current;if(!element)return;
    // The caller captures the trigger before making its containing pane inert.
    const document=element.ownerDocument,previous=returnFocus??document.activeElement;
    cancelButton.current?.focus({preventScroll:true});
    const onKey=(event:KeyboardEvent)=>{
      // Mounted dialogs in hidden tabs or other splits must not own this pane's keys.
      if(!element.getClientRects().length||!element.contains(document.activeElement))return;
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();cancel.current();return}
      if(event.key!=='Tab')return;
      const buttons=Array.from(element.querySelectorAll<HTMLButtonElement>('button')).filter(button=>!button.disabled&&button.getClientRects().length>0);
      const first=buttons[0]??element,last=buttons.at(-1)??element,active=document.activeElement;
      if(!buttons.length||event.shiftKey&&active===first||!event.shiftKey&&active===last){
        event.preventDefault();(event.shiftKey?last:first).focus({preventScroll:true});
      }
    };
    document.addEventListener('keydown',onKey,true);
    return()=>{
      document.removeEventListener('keydown',onKey,true);
      const active=document.activeElement;
      if(!element.contains(active)&&active!==document.body)return;
      // Layout cleanup runs before React removes the parent's inert attribute.
      // Wait for that commit, but never replace focus acquired by another pane
      // or a newly opened dialog in the meantime.
      queueMicrotask(()=>{
        const active=document.activeElement;
        if(!element.contains(active)&&active!==document.body)return;
        const valid=(target:Element|null|undefined):target is HTMLElement=>!!target&&target!==document.body&&target!==document.documentElement&&target.isConnected&&target.getClientRects().length>0&&!target.closest('[inert], [hidden], [aria-hidden="true"]')&&!target.matches(':disabled')&&typeof (target as HTMLElement).focus==='function';
        // A confirmed deletion can remove its own trigger; return to the graph then.
        const target=valid(previous)?previous:valid(fallbackFocus)?fallbackFocus:null;
        target?.focus({preventScroll:true});
      });
    };
  },[]);

  return <div className="modal-backdrop confirm-backdrop" onPointerDown={event=>{
    event.stopPropagation();if(event.target===event.currentTarget)cancel.current();
  }} onClick={event=>event.stopPropagation()}>
    <section ref={dialog} className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} tabIndex={-1}>
      <header><h2 id={`${id}-title`}>{title}</h2></header>
      <p id={`${id}-description`} className="confirm-description">{description}</p>
      <footer className="confirm-actions">
        <button ref={cancelButton} type="button" className="confirm-cancel" onClick={()=>cancel.current()}>Cancel</button>
        <button type="button" className="confirm-destructive" onClick={onConfirm}>{confirmLabel}</button>
      </footer>
    </section>
  </div>;
}
