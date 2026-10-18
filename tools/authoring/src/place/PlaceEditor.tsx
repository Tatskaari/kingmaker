// The place editor: a .kmplace file (a scene's place, the scenario format's). Under its title, a bar of
// views: the Plan (the place from above, five feet a square: its areas, its things where they stand, and
// where its people start, named, with an inspector for what's selected), the Place's own fields, its
// Areas, Things and People (who starts there), and its Problems. On a map, the same place is a layer
// over the region that lays it (the map editor).
import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {Redo2,Undo2,X} from 'lucide-react';
import type {FileHost} from '../campaign/host.ts';
import {useCampaignFiles,useEdits} from '../campaign/edits.ts';
import {campaignProblems,keyOfPath,withDraft} from '../campaign/files.ts';
import type {CampaignProblem} from '../campaign/files.ts';
import {EditSession} from '../scene/fields.tsx';
import {ConfirmDialog} from '../ConfirmDialog';
import {DocHeading,Inspector,ProblemsList,ViewArea,ViewBar,revealSoon,useFileView} from '../campaign/views.tsx';
import type {Use,ViewTab} from '../campaign/views.tsx';
import {FEET_PER_TILE,addArea,addPerson,addThing,areaAt,moveArea,movePerson,moveThing,onPlace,placeShapeOf,removeFromPlace,serializePlace,spotOf} from './model.ts';
import type {Feet,PlaceDocument} from './model.ts';
import {PlacePartInspector} from './inspectors.tsx';
import type {PlacePart} from './inspectors.tsx';
import {NewAreaDialog,NewStartDialog,NewThingDialog} from './dialogs.tsx';
import {AreasView,PlaceView,StartsView,ThingsView} from './views.tsx';
import type {PlaceAround,PlaceViewActions} from './views.tsx';
import {castUsesOf,thingUsesOf} from './uses.ts';
import {addCast,serializeScene} from '../scene/model.ts';
import '../campaign/views.css';
import '../map.css';

const GLYPHS:Record<string,string>={feature:'◆',object:'■',item:'•',creature:'¥',person:'☺'};
type View='plan'|'place'|'areas'|'things'|'people'|'problems';
const VIEW_IDS:View[]=['plan','place','areas','things','people','problems'];
type Selection={kind:'part';part:PlacePart}|{kind:'spot';at:Feet}|null;
type DialogState={kind:'thing'|'starts';at:Feet;area?:string;fixed?:boolean}|{kind:'area';at:Feet}|null;
type Confirmation={title:string;description:string;confirmLabel:string;run:()=>void};
/** Where each of a place's problems is: the view that has its field. */
const PART_VIEWS:Record<PlacePart['kind'],View>={area:'areas',thing:'things',person:'people'};

/** The editor for a place file, on its own plan. */
export function PlaceApp({document:initial,host}:{document:PlaceDocument;host:FileHost<PlaceDocument>}){
  const [toast,setToast]=useState('');
  const edits=useEdits<PlaceDocument>({host,initial,shape:placeShapeOf,serialize:serializePlace,onError:setToast});
  const campaign=useCampaignFiles(host,setToast);
  const doc=edits.doc;
  const ids=useId();
  const [view,setView]=useFileView<View>(host.filePath,'plan',VIEW_IDS);
  const [selection,setSelection]=useState<Selection>(null),[chosen,setChosen]=useState<{areas?:string;things?:string;people?:string}>({});
  const [menu,setMenu]=useState<{at:Feet;x:number;y:number}|null>(null),[dialog,setDialog]=useState<DialogState>(null),[confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const [names,setNames]=useState(true);
  /** A part being dragged: where it was (its spot, or an area's corner), where the pointer took hold of it, and where the pointer is. */
  const [drag,setDrag]=useState<{part:PlacePart;base:Feet;grab:Feet;at:Feet;moved:boolean}|null>(null);
  /** Where the plan was last clicked: something added in an area goes there. */
  const lastSpot=useRef<Feet|null>(null);
  const svg=useRef<SVGSVGElement>(null),stage=useRef<HTMLDivElement>(null),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(timer)},[toast]);

  // Its scenes (whose place it is), their cast, and the regions that lay it on a map.
  const scenes=campaign?.scenes.filter(scene=>scene.doc?.place===doc.id)??[];
  const cast=scenes.flatMap(scene=>scene.doc!.cast.map(member=>({id:member.id,name:member.name||member.id})));
  const listed=!!campaign?.scenario?.places.includes(doc.id);
  const problems=useMemo<CampaignProblem[]>(()=>campaign?.scenario&&listed?campaignProblems(withDraft(campaign,'place',doc.id,doc,serializePlace(doc))).filter(p=>p.path===host.filePath):[],[campaign,doc,listed]);
  const notes=[
    ...(!campaign?['Reading the campaign…']:[]),
    ...(campaign?.error?[`The campaign couldn't be read (${campaign.error}).`]:[]),
    ...(campaign?.scenario&&!listed?[`${doc.id} isn't one of the scenario's places: list it there for a scene to be played in it.`]:[]),
    ...(keyOfPath(host.filePath)!==doc.id?[`Its id is ${doc.id} and its file is named ${keyOfPath(host.filePath)}: a place's id is its file's name.`]:[]),
    ...(campaign&&!scenes.length?['No scene of the scenario is played here yet (a scene\'s place names it).']:[]),
  ];
  const around:PlaceAround={
    notes,
    scenes:scenes.map(scene=>({key:scene.key,title:scene.doc?.title||scene.key,path:scene.path})),
    laid:(campaign?.maps??[]).flatMap(map=>(map.doc?.regions??[]).filter(r=>r.worldOrigin&&scenes.some(scene=>scene.key===r.sceneId)).map(r=>{
      const width=Math.max(0,...(map.doc?.grid??[]).map(row=>[...row].length)),height=map.doc?.grid.length??0,tiles={w:Math.ceil(doc.size.w/FEET_PER_TILE),h:Math.ceil(doc.size.h/FEET_PER_TILE)};
      const fits=r.worldOrigin!.x+tiles.w<=width&&r.worldOrigin!.y+tiles.h<=height;
      return {map:map.key,mapTitle:map.doc?.title||map.key,region:r.id,name:r.name||r.id,origin:r.worldOrigin!,path:map.path,...(fits?{}:{fits:`its ${tiles.w} × ${tiles.h} tiles run off the map`})};
    })),
    startPlace:campaign?.scenario?.startPlace===doc.id,
  };
  const uses=(part:PlacePart):Use[]=>{
    const all=campaign?.scenes??[];
    const found=part.kind==='thing'?thingUsesOf(doc,part.id,all):part.kind==='person'?castUsesOf(doc,part.id,all):[];
    return found.map((use,i)=>({key:`${use.scene}:${i}`,label:`${use.sceneTitle}: ${use.where}`,detail:use.scene,onOpen:()=>open(use.path)}));
  };
  const looks=campaign?.looks??{};
  /** A scene's cast with someone new in it (their card's fields empty, for the author), as a write of the scene's file as it is now. */
  const castChange=async(scene:string,name:string,id:string)=>{
    const path=campaign?.scenes.find(file=>file.key===scene)?.path??`scenes/${scene}.kmscene`;
    const text=await host.files.read(path);
    if(text===undefined)throw new Error(`${path} isn't there, so they can't be added to its cast.`);
    const added=addCast(JSON.parse(text),name,id);
    if(added.id!==id)throw new Error(`${id} is in ${scene}'s cast already.`);
    return {path,before:text,after:serializeScene(added.doc)};
  };
  const open=(path:string)=>void host.open(path).catch(error=>setToast(String(error instanceof Error?error.message:error)));
  const select=(next:Selection)=>{setSelection(next);setMenu(null)};
  const selectPart=(part:PlacePart|null)=>select(part?{kind:'part',part}:null);
  const ask=(next:Confirmation)=>{setMenu(null);setConfirmation(next)};
  const confirm=(title:string,description:string,label:string,run:()=>void)=>ask({title,description,confirmLabel:label,run});
  const change=(next:PlaceDocument)=>{edits.commit(next,true)};
  /** A dialog for something new in an area: at the spot last clicked in it, or its middle. */
  const addIn=(kind:'thing'|'starts'|'area',area?:string)=>{
    if(kind==='area'){setDialog({kind:'area',at:[0,0]});return}
    const a=doc.areas.find(x=>x.id===area)??doc.areas[0];
    const spot=lastSpot.current,inside=spot&&a&&areaAt(doc,spot)?.id===a.id;
    const at:Feet=inside?spot!:a?[Math.round(a.rect.x+a.rect.w/2),Math.round(a.rect.y+a.rect.h/2)]:[Math.round(doc.size.w/2),Math.round(doc.size.h/2)];
    setDialog({kind,at,area:a?.id,fixed:false});
  };

  // Feet under a point of the page.
  const feetAt=(e:{clientX:number;clientY:number}):Feet=>{
    const element=svg.current!,point=element.createSVGPoint();
    point.x=e.clientX;point.y=e.clientY;
    const m=element.getScreenCTM()?.inverse();
    const p=m?point.matrixTransform(m):{x:0,y:0};
    return [Math.round(p.x),Math.round(p.y)];
  };
  const startDrag=(e:React.PointerEvent,part:PlacePart,base:Feet)=>{if(e.button!==0)return;e.stopPropagation();(e.currentTarget as Element).setPointerCapture(e.pointerId);const grab=feetAt(e);lastSpot.current=grab;setDrag({part,base,grab,at:grab,moved:false})};
  const moveDrag=(e:React.PointerEvent)=>{if(!drag)return;const at=feetAt(e);if(at[0]!==drag.at[0]||at[1]!==drag.at[1])setDrag({...drag,at,moved:true})};
  /** Where a dragged part is now: where it was, moved as far as the pointer has. */
  const dropped=(d:NonNullable<typeof drag>):Feet=>[d.base[0]+d.at[0]-d.grab[0],d.base[1]+d.at[1]-d.grab[1]];
  const endDrag=()=>{
    if(!drag)return;
    const {part,moved}=drag,to=dropped(drag);setDrag(null);
    if(!moved){selectPart(part);return}
    if(part.kind==='thing')change(moveThing(edits.current.current,part.id,to));
    else if(part.kind==='person')change(movePerson(edits.current.current,part.id,to));
    else change(moveArea(edits.current.current,part.id,to[0],to[1]));
  };
  const shift=(part:PlacePart,base:Feet):Feet=>drag&&drag.part.kind===part.kind&&drag.part.id===part.id?dropped({...drag,base}):base;
  const isChosen=(kind:PlacePart['kind'],id:string)=>selection?.kind==='part'&&selection.part.kind===kind&&selection.part.id===id;
  const pad=FEET_PER_TILE*2,box=`${-pad} ${-pad} ${doc.size.w+pad*2} ${doc.size.h+pad*2}`;
  const lines:React.ReactNode[]=[];
  for(let x=0;x<=doc.size.w;x+=FEET_PER_TILE)lines.push(<line key={`x${x}`} x1={x} y1={0} x2={x} y2={doc.size.h}/>);
  for(let y=0;y<=doc.size.h;y+=FEET_PER_TILE)lines.push(<line key={`y${y}`} x1={0} y1={y} x2={doc.size.w} y2={y}/>);
  const nameOf=(id:string)=>id==='player'?'the player':cast.find(member=>member.id===id)?.name??id;

  const contextMenu=(e:React.MouseEvent)=>{
    e.preventDefault();
    const at=feetAt(e),bounds=stage.current!.getBoundingClientRect();
    lastSpot.current=at;
    setMenu({at,x:Math.min(e.clientX-bounds.left,bounds.width-260),y:Math.min(e.clientY-bounds.top,bounds.height-220)});
  };
  const menuItems=()=>{
    if(!menu)return null;
    const area=areaAt(doc,menu.at);
    const item=(label:string,run:()=>void,danger=false)=><button key={label} role="menuitem" className={danger?'danger':''} onClick={()=>{setMenu(null);run()}}>{label}</button>;
    // Off the place's floor nothing can be added: the game lays the place from its corner, and the campaign check names a spot past its edges.
    if(!onPlace(doc,menu.at))return <div className="map-context-menu" role="menu" aria-label={`At ${menu.at[0]}, ${menu.at[1]} feet`} style={{left:menu.x,top:menu.y}}>
      <small>{menu.at[0]}, {menu.at[1]} ft · off the place, which is {doc.size.w} × {doc.size.h} feet: right-click on it to add to it, or make it bigger in the Place view.</small>
    </div>;
    return <div className="map-context-menu" role="menu" aria-label={`At ${menu.at[0]}, ${menu.at[1]} feet`} style={{left:menu.x,top:menu.y}}>
      <small>{menu.at[0]}, {menu.at[1]} ft{area?` · ${area.name}`:''}</small>
      {item('Add a thing here…',()=>setDialog({kind:'thing',at:menu.at,area:area?.id}))}
      {item('Add an area here…',()=>setDialog({kind:'area',at:menu.at}))}
      {item('Start someone here…',()=>setDialog({kind:'starts',at:menu.at,area:area?.id}))}
    </div>;
  };

  // ---- The inspector: what's selected on the plan ----
  const inspectorBody=()=>{
    if(!selection)return <p className="info-box">Click an area, a thing or someone to edit them here; drag them to move them. Click the floor to add to it there (or right-click it). The place's own fields, its areas, things and people are views of their own, in the bar above.</p>;
    if(selection.kind==='spot'){
      const at=selection.at,area=areaAt(doc,at),on=onPlace(doc,at);
      return <div className="spot-inspector">
        <p className="inspector-kind"><span className="kind-dot place"/>A spot<code>{at[0]}, {at[1]} ft</code></p>
        <p className="muted">{on?area?`In ${area.name||area.id}.`:'On the floor, in no area: a thing or someone here needs an area.':`Off the place, which is ${doc.size.w} × ${doc.size.h} feet: nothing can be added here (make it bigger in the Place view).`}</p>
        {on&&<div className="tile-actions">
          <button type="button" onClick={()=>setDialog({kind:'thing',at,area:area?.id})}>Add a thing here…</button>
          <button type="button" onClick={()=>setDialog({kind:'area',at})}>Add an area here…</button>
          <button type="button" onClick={()=>setDialog({kind:'starts',at,area:area?.id})}>Start someone here…</button>
        </div>}
      </div>;
    }
    return <PlacePartInspector key={`${selection.part.kind}:${selection.part.id}`} part={selection.part} doc={doc} onChange={change} onSelect={selectPart} confirm={confirm} cast={cast} uses={uses} onAdd={(kind,area)=>addIn(kind,area)} onRenamed={(part,to)=>select({kind:'part',part:{...part,id:to}})}/>;
  };
  const what=selection?.kind==='spot'?<><span className="kind-dot place"/>A spot<code>{selection.at[0]}, {selection.at[1]} ft</code></>:selection?.kind==='part'?<><span className={`kind-dot ${selection.part.kind}`}/>{selection.part.kind==='area'?'Area':selection.part.kind==='thing'?'Thing':`Starts here: ${nameOf(selection.part.id)}`}<code>{selection.part.id}</code></>:'Nothing selected';

  // ---- Going to a problem ----
  const go=(problem:CampaignProblem)=>{
    const at=problem.at;
    if(at.kind!=='place'){open(problem.path);return}
    const id=at.thing??at.area??at.person;
    if(id){const kind=at.thing?'thing':at.area?'area':'person';const list=PART_VIEWS[kind];setChosen(old=>({...old,[list]:id}));setView(list);return}
    setView('place');revealSoon(root.current,at.field??'title');
  };

  const actions:PlaceViewActions={
    edit:change,
    showOnPlan:part=>{setView('plan');selectPart(part)},
    confirm,
    add:(kind,area)=>addIn(kind,area),
    open,
    renamed:(part,to)=>{if(selection?.kind==='part'&&selection.part.id===part.id)select({kind:'part',part:{...part,id:to}})},
    choose:part=>{const list=PART_VIEWS[part.kind];setChosen(old=>({...old,[list]:part.id}));setView(list)},
  };
  const tabs:ViewTab<View>[]=[{id:'plan',label:'Plan'},{id:'place',label:'Place'},{id:'areas',label:'Areas',count:doc.areas.length},{id:'things',label:'Things',count:doc.things.length},{id:'people',label:'People',count:Object.keys(doc.people).length},{id:'problems',label:'Problems',...(campaign&&listed?{count:problems.length,bad:true}:{})}];
  const scroll=(node:React.ReactNode)=><div className="view-scroll">{node}</div>;
  return <EditSession.Provider value={edits.sessionHandlers}><div className="km-workshop km-forms km-map km-place" ref={root} tabIndex={-1} data-campaign={campaign?'read':'reading'} onKeyDown={e=>{
    if(confirmation||dialog||(e.target instanceof HTMLElement&&e.target.closest('input,textarea,select')))return;
    if(e.key==='Escape'){setMenu(null);setDrag(null);return}
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();if(e.key.toLowerCase()==='y'||e.shiftKey)void edits.redo();else void edits.undo()}
  }}>
    <div className="map-body" inert={!!confirmation||!!dialog||undefined}>
      <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">Autosaves to this file</span></header>
      <DocHeading kind="place" id={doc.id} title={doc.title} problems={problems.length} checking={!campaign} onProblems={()=>setView('problems')}/>
      <ViewBar ids={ids} label="Views of the place" views={tabs} view={view} onView={setView} actions={<>
        <button type="button" aria-label="Undo place edit" title="Undo (Ctrl Z)" disabled={!edits.canUndo} onClick={()=>void edits.undo()}><Undo2 size={16}/></button>
        <button type="button" aria-label="Redo place edit" title="Redo (Ctrl Shift Z)" disabled={!edits.canRedo} onClick={()=>void edits.redo()}><Redo2 size={16}/></button>
      </>}/>
      <ViewArea ids={ids} view={view}>
        {view==='plan'&&<div className="paint-view">
          <div className="map-toolbar">
            <span className="map-hint">{doc.size.w} × {doc.size.h} feet · five feet a square, from above, north at the top</span>
            <span className="place-layers">{around.laid.length?around.laid.map(layer=><button key={`${layer.map}:${layer.region}`} title={`Open ${layer.path}`} onClick={()=>open(layer.path)}>On {layer.mapTitle}, over “{layer.name}” ({layer.origin.x}, {layer.origin.y}) ↗</button>):<span className="muted">No region lays it on a map: it's edited on its own plan.</span>}</span>
            <label className="map-check"><input type="checkbox" checked={names} onChange={e=>setNames(e.target.checked)}/>Names</label>
          </div>
          <div className="map-content">
            <div className="map-stage place-stage" ref={stage} onPointerDown={e=>{if(menu&&!(e.target as HTMLElement).closest('.map-context-menu'))setMenu(null)}}>
              <svg ref={svg} className="place-grid" viewBox={box} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${doc.title} from above`} onContextMenu={contextMenu} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={()=>setDrag(null)}
                onPointerDown={e=>{if(e.button!==0||drag)return;const at=feetAt(e);lastSpot.current=at;select({kind:'spot',at})}}>
                <rect className="place-floor" x={0} y={0} width={doc.size.w} height={doc.size.h}/>
                <g className="place-lines">{lines}</g>
                {selection?.kind==='spot'&&<circle className="place-spot" cx={selection.at[0]} cy={selection.at[1]} r={1}/>}
                {doc.areas.map(area=>{const [x,y]=shift({kind:'area',id:area.id},[area.rect.x,area.rect.y]);return <g key={area.id} className={`place-area${isChosen('area',area.id)?' chosen':''}`} data-area={area.id}>
                  <rect x={x} y={y} width={area.rect.w} height={area.rect.h} onPointerDown={e=>startDrag(e,{kind:'area',id:area.id},[area.rect.x,area.rect.y])}/>
                  <text x={x+1} y={y+1}>{area.name||area.id}</text>
                </g>})}
                {doc.things.map(thing=>{const base=thing.at;if(!base)return null;const [x,y]=shift({kind:'thing',id:thing.id},base);return <g key={thing.id} className={`place-thing${isChosen('thing',thing.id)?' chosen':''}`} data-thing={thing.id} role="button" aria-label={`Thing ${thing.name}`} onPointerDown={e=>startDrag(e,{kind:'thing',id:thing.id},base)}>
                  <circle cx={x} cy={y} r={1.3}/><text x={x} y={y+.7}>{GLYPHS[thing.kind??'']??'◇'}</text><title>{thing.name} ({thing.id})</title>
                  {names&&<text className="place-name" x={x} y={y+2.2}>{thing.name||thing.id}</text>}
                </g>})}
                {Object.entries(doc.people).map(([id,person])=>{const base=person.at??spotOf(doc,id)??[doc.areas.find(a=>a.id===person.in)?.rect.x??0,doc.areas.find(a=>a.id===person.in)?.rect.y??0] as Feet;const [x,y]=shift({kind:'person',id},base);const look=id==='player'?{glyph:'@',fg:'#f0e6c8'}:looks[id]??{};return <g key={id} className={`place-person${isChosen('person',id)?' chosen':''}`} data-starts={id} role="button" aria-label={`${id} starts here`} onPointerDown={e=>startDrag(e,{kind:'person',id},base)}>
                  <circle cx={x} cy={y} r={1.6}/><text x={x} y={y+.7} style={{fill:look.fg??'#e8dcc0'}}>{look.glyph??id.charAt(0).toUpperCase()}</text><title>{nameOf(id)}{person.note?`: ${person.note}`:''}</title>
                  {names&&<text className="place-name cast" x={x} y={y+2.6}>{nameOf(id)}</text>}
                </g>})}
              </svg>
              {menuItems()}
            </div>
            <Inspector what={what} empty={!selection} onClose={()=>select(null)} className="place-inspector-panel">{inspectorBody()}</Inspector>
          </div>
        </div>}
        {view==='place'&&scroll(<PlaceView doc={doc} actions={actions} around={around}/>)}
        {view==='areas'&&scroll(<AreasView doc={doc} actions={actions} cast={cast} uses={uses} chosen={chosen.areas} onChoose={id=>setChosen(old=>({...old,areas:id}))}/>)}
        {view==='things'&&scroll(<ThingsView doc={doc} actions={actions} cast={cast} uses={uses} chosen={chosen.things} onChoose={id=>setChosen(old=>({...old,things:id}))}/>)}
        {view==='people'&&scroll(<StartsView doc={doc} actions={actions} cast={cast} uses={uses} chosen={chosen.people} onChoose={id=>setChosen(old=>({...old,people:id}))}/>)}
        {view==='problems'&&scroll(<ProblemsList lede={<>The campaign check's rules for this place (<code>npm run campaign -- check</code>), with the place as it is now. Each takes you to its area, thing or start.</>} problems={problems} notes={notes} checking={!campaign} clear="No problems: the campaign check finds nothing in this place." onGo={go} where={problem=>problem.at.kind==='place'?[problem.file,problem.at.area&&`area ${problem.at.area}`,problem.at.thing&&`thing ${problem.at.thing}`,problem.at.person&&`${problem.at.person}'s start`].filter(Boolean).join(' · '):problem.file}/>)}
      </ViewArea>
      {toast&&<div className="toast" role="status">{toast}<button aria-label="Dismiss" onClick={()=>setToast('')}><X size={12}/></button></div>}
    </div>
    {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} onCancel={()=>setConfirmation(null)} onConfirm={()=>{const run=confirmation.run;setConfirmation(null);run()}}/>}
    {dialog?.kind==='thing'&&<NewThingDialog doc={doc} at={dialog.at} area={dialog.area} fixed={dialog.fixed??true} onClose={()=>setDialog(null)} onAdd={thing=>{if(edits.commit(addThing(edits.current.current,thing))){setDialog(null);setChosen(old=>({...old,things:thing.id}));if(view==='plan')selectPart({kind:'thing',id:thing.id})}}}/>}
    {dialog?.kind==='area'&&<NewAreaDialog doc={doc} rect={{x:dialog.at[0],y:dialog.at[1],w:Math.min(10,Math.max(5,doc.size.w-dialog.at[0])),h:Math.min(10,Math.max(5,doc.size.h-dialog.at[1]))}} onClose={()=>setDialog(null)} onAdd={area=>{if(edits.commit(addArea(edits.current.current,area))){setDialog(null);setChosen(old=>({...old,areas:area.id}));if(view==='plan')selectPart({kind:'area',id:area.id})}}}/>}
    {dialog?.kind==='starts'&&<NewStartDialog doc={doc} at={dialog.at} area={dialog.area} fixed={dialog.fixed??true} cast={cast} scenes={around.scenes} onClose={()=>setDialog(null)} onAdd={(id,where,created)=>{
      const started=()=>{setDialog(null);setChosen(old=>({...old,people:id}));if(view==='plan')selectPart({kind:'person',id})};
      if(!created){if(edits.commit(addPerson(edits.current.current,id,where)))started();return}
      // Someone new of a scene's cast: their card in the scene's file and their start here, one step.
      void castChange(created.scene,created.name,id).then(change=>edits.write([change],addPerson(edits.current.current,id,where))).then(ok=>{if(ok)started()}).catch(error=>setToast(String(error instanceof Error?error.message:error)));
    }}/>}
  </div></EditSession.Provider>;
}

export {removeFromPlace};
