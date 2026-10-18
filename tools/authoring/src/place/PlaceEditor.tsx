// The place editor: a .kmplace file (a scene's place, the scenario format's) on its own grid, from above,
// five feet a square: its areas as rectangles, its things where they stand, and where its people start.
// On a map, the same place is a layer over the region that lays it (the map editor).
import React,{useMemo,useRef,useState} from 'react';
import {AlertTriangle,CheckCircle2,ExternalLink,Info,X} from 'lucide-react';
import type {FileHost} from '../campaign/host.ts';
import {useCampaignFiles,useEdits} from '../campaign/edits.ts';
import {campaignProblems,keyOfPath,withDraft} from '../campaign/files.ts';
import {EditSession} from '../scene/fields.tsx';
import {ConfirmDialog} from '../ConfirmDialog';
import {FEET_PER_TILE,addArea,addPerson,addThing,areaAt,moveArea,movePerson,moveThing,onPlace,placeShapeOf,removeFromPlace,serializePlace,spotOf} from './model.ts';
import type {Feet,PlaceDocument} from './model.ts';
import {PlacePanel,PlacePartInspector} from './inspectors.tsx';
import type {PlacePart} from './inspectors.tsx';
import {NewAreaDialog,NewStartDialog,NewThingDialog} from './dialogs.tsx';
import '../map.css';

const GLYPHS:Record<string,string>={feature:'◆',object:'■',item:'•',creature:'¥',person:'☺'};
type DialogState={kind:'thing'|'starts';at:Feet;area?:string}|{kind:'area';at:Feet}|null;
type Confirmation={title:string;description:string;confirmLabel:string;run:()=>void};

/** The editor for a place file, on its own grid. */
export function PlaceApp({document:initial,host}:{document:PlaceDocument;host:FileHost<PlaceDocument>}){
  const [toast,setToast]=useState('');
  const edits=useEdits<PlaceDocument>({host,initial,shape:placeShapeOf,serialize:serializePlace,onError:setToast});
  const campaign=useCampaignFiles(host,setToast);
  const doc=edits.doc;
  const [selected,setSelected]=useState<PlacePart|null>(null),[tab,setTab]=useState<'selected'|'place'|'problems'>('place');
  const [menu,setMenu]=useState<{at:Feet;x:number;y:number}|null>(null),[dialog,setDialog]=useState<DialogState>(null),[confirmation,setConfirmation]=useState<Confirmation|null>(null);
  /** A part being dragged: where it was (its spot, or an area's corner), where the pointer took hold of it, and where the pointer is. */
  const [drag,setDrag]=useState<{part:PlacePart;base:Feet;grab:Feet;at:Feet;moved:boolean}|null>(null);
  const svg=useRef<SVGSVGElement>(null),stage=useRef<HTMLDivElement>(null);

  // Its scene (the one whose place it is), that scene's cast, and the regions that lay it on a map.
  const scenes=campaign?.scenes.filter(scene=>scene.doc?.place===doc.id)??[];
  const cast=scenes.flatMap(scene=>scene.doc!.cast.map(member=>({id:member.id,name:member.name||member.id})));
  const layers=campaign?.maps.flatMap(map=>map.doc?.regions.filter(r=>r.worldOrigin&&scenes.some(scene=>scene.key===r.sceneId)).map(r=>({map:map.key,path:map.path,region:r.id,origin:r.worldOrigin!}))??[])??[];
  const listed=!!campaign?.scenario?.places.includes(doc.id);
  const problems=useMemo(()=>campaign?.scenario&&listed?campaignProblems(withDraft(campaign,'place',doc.id,doc,serializePlace(doc))).filter(p=>p.path===host.filePath):[],[campaign,doc,listed]);
  const notes=[
    ...(!campaign?['Reading the campaign…']:[]),
    ...(campaign?.error?[`The campaign couldn't be read (${campaign.error}).`]:[]),
    ...(campaign?.scenario&&!listed?[`${doc.id} isn't one of the scenario's places: list it there for a scene to be played in it.`]:[]),
    ...(keyOfPath(host.filePath)!==doc.id?[`Its id is ${doc.id} and its file is named ${keyOfPath(host.filePath)}: a place's id is its file's name.`]:[]),
    ...(campaign&&!scenes.length?['No scene of the scenario is played here yet (a scene\'s place names it).']:[]),
  ];
  const looks=campaign?.looks??{};
  const select=(part:PlacePart|null)=>{setSelected(part);if(part)setTab('selected');setMenu(null)};
  const ask=(confirmation:Confirmation)=>{setMenu(null);setConfirmation(confirmation)};
  const change=(next:PlaceDocument)=>edits.commit(next,true);

  // Feet under a point of the page.
  const feetAt=(e:{clientX:number;clientY:number}):Feet=>{
    const element=svg.current!,point=element.createSVGPoint();
    point.x=e.clientX;point.y=e.clientY;
    const m=element.getScreenCTM()?.inverse();
    const p=m?point.matrixTransform(m):{x:0,y:0};
    return [Math.round(p.x),Math.round(p.y)];
  };
  const startDrag=(e:React.PointerEvent,part:PlacePart,base:Feet)=>{if(e.button!==0)return;e.stopPropagation();(e.currentTarget as Element).setPointerCapture(e.pointerId);const grab=feetAt(e);setDrag({part,base,grab,at:grab,moved:false})};
  const moveDrag=(e:React.PointerEvent)=>{if(!drag)return;const at=feetAt(e);if(at[0]!==drag.at[0]||at[1]!==drag.at[1])setDrag({...drag,at,moved:true})};
  /** Where a dragged part is now: where it was, moved as far as the pointer has. */
  const dropped=(d:NonNullable<typeof drag>):Feet=>[d.base[0]+d.at[0]-d.grab[0],d.base[1]+d.at[1]-d.grab[1]];
  const endDrag=()=>{
    if(!drag)return;
    const {part,moved}=drag,to=dropped(drag);setDrag(null);
    if(!moved){select(part);return}
    if(part.kind==='thing')change(moveThing(edits.current.current,part.id,to));
    else if(part.kind==='person')change(movePerson(edits.current.current,part.id,to));
    else change(moveArea(edits.current.current,part.id,to[0],to[1]));
  };
  const shift=(part:PlacePart,base:Feet):Feet=>drag&&drag.part.kind===part.kind&&drag.part.id===part.id?dropped({...drag,base}):base;
  const chosen=(kind:PlacePart['kind'],id:string)=>selected?.kind===kind&&selected.id===id;
  const pad=FEET_PER_TILE*2,view=`${-pad} ${-pad} ${doc.size.w+pad*2} ${doc.size.h+pad*2}`;
  const lines:React.ReactNode[]=[];
  for(let x=0;x<=doc.size.w;x+=FEET_PER_TILE)lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={doc.size.h}/>);
  for(let y=0;y<=doc.size.h;y+=FEET_PER_TILE)lines.push(<line key={`y${y}`} x1={0} y1={y} x2={doc.size.w} y2={y}/>);

  const contextMenu=(e:React.MouseEvent)=>{
    e.preventDefault();
    const at=feetAt(e),box=stage.current!.getBoundingClientRect();
    setMenu({at,x:Math.min(e.clientX-box.left,box.width-260),y:Math.min(e.clientY-box.top,box.height-220)});
  };
  const menuItems=()=>{
    if(!menu)return null;
    const area=areaAt(doc,menu.at);
    const item=(label:string,run:()=>void,danger=false)=><button key={label} role="menuitem" className={danger?'danger':''} onClick={()=>{setMenu(null);run()}}>{label}</button>;
    // Off the place's floor nothing can be added: the game lays the place from its corner, and the campaign check names a spot past its edges.
    if(!onPlace(doc,menu.at))return <div className="map-context-menu" role="menu" aria-label={`At ${menu.at[0]}, ${menu.at[1]} feet`} style={{left:menu.x,top:menu.y}}>
      <small>{menu.at[0]}, {menu.at[1]} ft · off the place, which is {doc.size.w} × {doc.size.h} feet: right-click on it to add to it, or make it bigger in the Place tab.</small>
    </div>;
    return <div className="map-context-menu" role="menu" aria-label={`At ${menu.at[0]}, ${menu.at[1]} feet`} style={{left:menu.x,top:menu.y}}>
      <small>{menu.at[0]}, {menu.at[1]} ft{area?` · ${area.name}`:''}</small>
      {item('Add a thing here…',()=>setDialog({kind:'thing',at:menu.at,area:area?.id}))}
      {item('Add an area here…',()=>setDialog({kind:'area',at:menu.at}))}
      {item('Start someone here…',()=>setDialog({kind:'starts',at:menu.at,area:area?.id}))}
    </div>;
  };

  const body=()=>{
    if(tab==='place')return <PlacePanel doc={doc} onChange={change} onSelect={select} onAdd={kind=>setDialog(kind==='area'?{kind:'area',at:[0,0]}:{kind:kind==='thing'?'thing':'starts',at:[Math.round(doc.size.w/2),Math.round(doc.size.h/2)]})}/>;
    if(tab==='problems')return <div className="problems-panel">
      {notes.map(note=><p className="problems-note" key={note}><Info size={14}/>{note}</p>)}
      {listed&&(problems.length?<p className="muted">The campaign check would refuse the campaign for {problems.length===1?'this':`these ${problems.length}`}.</p>:<p className="problems-clear"><CheckCircle2 size={15}/>No problems: the campaign check finds nothing in this place.</p>)}
      <ol className="problems">{problems.map((problem,i)=><li key={`${i}:${problem.message}`}><button type="button" className="problem" onClick={()=>{const at=problem.at;if(at.kind==='place'){const id=at.thing??at.area??at.person;if(id)select({kind:at.thing?'thing':at.area?'area':'person',id})}}}><AlertTriangle size={14}/><span><b>{problem.message}</b><small>{problem.file}</small></span></button></li>)}</ol>
    </div>;
    if(!selected)return <p className="info-box">Click an area, a thing or someone to edit them here; drag them to move them. Right-click the grid to add to the place.</p>;
    return <PlacePartInspector key={`${selected.kind}:${selected.id}`} part={selected} doc={doc} onChange={change} onSelect={select} confirm={(title,description,label,run)=>ask({title,description,confirmLabel:label,run})} cast={cast}/>;
  };
  const tabs:[typeof tab,string,number|undefined][]=[['selected','Selected',undefined],['place','Place',undefined],['problems','Problems',campaign&&listed?problems.length:undefined]];
  return <EditSession.Provider value={edits.sessionHandlers}><div className="km-workshop km-forms km-map km-place" tabIndex={-1} data-campaign={campaign?'read':'reading'} onKeyDown={e=>{
    if(confirmation||dialog||(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select')))return;
    if(e.key==='Escape'){setMenu(null);setDrag(null);return}
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='y'||e.shiftKey)void edits.redo();else void edits.undo()}
  }}>
    <div className="map-body" inert={!!confirmation||!!dialog||undefined}>
      <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">Autosaves to this file</span></header>
      <div className="map-heading">
        <div><div className="eyebrow">KINGMAKER · PLACE · <code>{doc.id}</code></div><h1>{doc.title||doc.id}</h1></div>
        <div className="place-layers">{layers.length?layers.map(layer=><button key={`${layer.map}:${layer.region}`} onClick={()=>void host.open(layer.path)}>Laid on {layer.map} at {layer.region} ({layer.origin.x}, {layer.origin.y}) <ExternalLink size={12}/></button>):<span className="muted">No region lays it on a map: it's edited on its own grid.</span>}</div>
      </div>
      <div className="map-toolbar"><div><span className="map-hint">{doc.size.w} × {doc.size.h} feet · five feet a square, from above, north at the top</span></div><div><button aria-label="Undo place edit" disabled={!edits.canUndo} onClick={()=>void edits.undo()}>↶ Undo</button><button aria-label="Redo place edit" disabled={!edits.canRedo} onClick={()=>void edits.redo()}>↷ Redo</button></div></div>
      <div className="map-content">
        <div className="map-stage place-stage" ref={stage} onPointerDown={e=>{if(menu&&!(e.target as HTMLElement).closest('.map-context-menu'))setMenu(null)}}>
          <svg ref={svg} className="place-grid" viewBox={view} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${doc.title} from above`} onContextMenu={contextMenu} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={()=>setDrag(null)}>
            <rect className="place-floor" x={0} y={0} width={doc.size.w} height={doc.size.h}/>
            <g className="place-lines">{lines}</g>
            {doc.areas.map(area=>{const [x,y]=shift({kind:'area',id:area.id},[area.rect.x,area.rect.y]);return <g key={area.id} className={`place-area${chosen('area',area.id)?' chosen':''}`} data-area={area.id}>
              <rect x={x} y={y} width={area.rect.w} height={area.rect.h} onPointerDown={e=>startDrag(e,{kind:'area',id:area.id},[area.rect.x,area.rect.y])}/>
              <text x={x+1} y={y+3}>{area.name||area.id}</text>
            </g>})}
            {doc.things.map(thing=>{const base=thing.at;if(!base)return null;const [x,y]=shift({kind:'thing',id:thing.id},base);return <g key={thing.id} className={`place-thing${chosen('thing',thing.id)?' chosen':''}`} data-thing={thing.id} role="button" aria-label={`Thing ${thing.name}`} onPointerDown={e=>startDrag(e,{kind:'thing',id:thing.id},base)}>
              <circle cx={x} cy={y} r={1.3}/><text x={x} y={y+.7}>{GLYPHS[thing.kind??'']??'◇'}</text><title>{thing.name} ({thing.id})</title>
            </g>})}
            {Object.entries(doc.people).map(([id,person])=>{const base=person.at??spotOf(doc,id)??[doc.areas.find(a=>a.id===person.in)?.rect.x??0,doc.areas.find(a=>a.id===person.in)?.rect.y??0] as Feet;const [x,y]=shift({kind:'person',id},base);const look=id==='player'?{glyph:'@',fg:'#f0e6c8'}:looks[id]??{};return <g key={id} className={`place-person${chosen('person',id)?' chosen':''}`} data-starts={id} role="button" aria-label={`${id} starts here`} onPointerDown={e=>startDrag(e,{kind:'person',id},base)}>
              <circle cx={x} cy={y} r={1.6}/><text x={x} y={y+.7} style={{fill:look.fg??'#e8dcc0'}}>{look.glyph??id.charAt(0).toUpperCase()}</text><title>{id}{person.note?`: ${person.note}`:''}</title>
            </g>})}
          </svg>
          {menuItems()}
        </div>
        <aside className="inspector map-inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector">{tabs.map(([id,label,count])=><button key={id} role="tab" aria-selected={tab===id} aria-label={count===undefined?label:`${label} (${count})`} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}{count!==undefined&&<span className={`count${id==='problems'&&count?' bad':''}`}>{count}</span>}</button>)}</div>
          <div className="inspector-body" role="tabpanel">{body()}</div>
        </aside>
      </div>
      {toast&&<div className="toast" role="status">{toast}<button aria-label="Dismiss" onClick={()=>setToast('')}><X size={12}/></button></div>}
    </div>
    {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} onCancel={()=>setConfirmation(null)} onConfirm={()=>{const run=confirmation.run;setConfirmation(null);run()}}/>}
    {dialog?.kind==='thing'&&<NewThingDialog doc={doc} at={dialog.at} area={dialog.area} onClose={()=>setDialog(null)} onAdd={thing=>{if(edits.commit(addThing(edits.current.current,thing))){setDialog(null);select({kind:'thing',id:thing.id})}}}/>}
    {dialog?.kind==='area'&&<NewAreaDialog doc={doc} rect={{x:dialog.at[0],y:dialog.at[1],w:10,h:10}} onClose={()=>setDialog(null)} onAdd={area=>{if(edits.commit(addArea(edits.current.current,area))){setDialog(null);select({kind:'area',id:area.id})}}}/>}
    {dialog?.kind==='starts'&&<NewStartDialog doc={doc} at={dialog.at} area={dialog.area} cast={cast} onClose={()=>setDialog(null)} onAdd={(id,where)=>{if(edits.commit(addPerson(edits.current.current,id,where))){setDialog(null);select({kind:'person',id})}}}/>}
  </div></EditSession.Provider>;
}

export {removeFromPlace};
