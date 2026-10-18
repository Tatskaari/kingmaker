// The map editor: a .kmmap file (the scenario format's map, version 2) painted in its legend's
// characters on an isometric view, its regions, exits and people on it, the scenario's start where it
// is, a scene's place laid over the region that plays it, and the game's own renderer as its preview.
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {AlertTriangle,CheckCircle2,Flag,Info,Pencil,Plus,X} from 'lucide-react';
import type {FileHost} from '../campaign/host.ts';
import {useCampaignFiles,useEdits,useWritten} from '../campaign/edits.ts';
import type {FileChange} from '../campaign/edits.ts';
import {campaignProblems,keyOfPath,pathIn,withDraft} from '../campaign/files.ts';
import type {CampaignProblem} from '../campaign/files.ts';
import {EditSession} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {ConfirmDialog} from '../ConfirmDialog';
import {MAP_LIMIT,MAP_MIN,TIMES,VOID,addExit,addLegendEntry,addPerson,addRegion,cellAt,cellsOf,entryName,fill,inside,mapShapeOf,movedPoint,regionIds,removeExits,removeLegendEntry,removePerson,removeRegion,resizeCells,resizeMap,sameCells,serializeMap,setExit,setLegendEntry,setPersonField,setRegionField,thingsAt,usage,withCells} from './model.ts';
import type {Cells,MapDocument,MapEdge,PlaceRegion,Resize,Tile2,TimeOfDay} from './model.ts';
import {MapPixi,mapTileAt} from './pixi.ts';
import {MapStroke} from './stroke.ts';
import {MapHover,MapHoverStore} from './hover.tsx';
import {compiled as compileMap,preview} from './preview.ts';
import {swatchOf} from './look.ts';
import {ExitInspector,LegendInspector,MapPanel,PersonInspector,RegionInspector} from './inspectors.tsx';
import {NewExitDialog,NewLegendEntryDialog,NewPersonDialog,NewRegionDialog,RemoveLegendEntryDialog} from './dialogs.tsx';
import {landingOn,serializeScenario,withStart} from '../scenario/model.ts';
import {PlacePanel,PlacePartInspector} from '../place/inspectors.tsx';
import type {PlacePart} from '../place/inspectors.tsx';
import {NewAreaDialog,NewStartDialog,NewThingDialog} from '../place/dialogs.tsx';
import {FEET_PER_TILE,addArea,addPerson as addPlacePerson,addThing,areaAt,feetMoved,feetOfTile,moveArea,movePerson,moveThing,placeShapeOf,removeFromPlace,serializePlace,tilesOf} from '../place/model.ts';
import type {Feet,PlaceDocument} from '../place/model.ts';
import '../map.css';

type Mode='edit'|'preview';
type Tool='brush'|'rectangle'|'fill'|'erase'|'sample'|'pan'|'region'|'resize';
const TOOLS:Array<{id:Tool;name:string;key:string;icon:string}>=[
  {id:'brush',name:'Brush',key:'B',icon:'✎'},{id:'rectangle',name:'Rectangle',key:'R',icon:'▱'},{id:'fill',name:'Fill',key:'G',icon:'◈'},
  {id:'erase',name:'Erase',key:'E',icon:'⌫'},{id:'sample',name:'Eyedropper',key:'I',icon:'⌖'},{id:'pan',name:'Pan',key:'H',icon:'✥'},
  {id:'region',name:'Region',key:'N',icon:'⬚'},{id:'resize',name:'Resize',key:'S',icon:'⤢'},
];
type Selection={kind:'region'|'exit'|'person';index:number}|{kind:'legend';ch:string}|{kind:'start'}|{kind:'place';part:PlacePart}|null;
type DialogState={kind:'legend'}|{kind:'unlegend';ch:string}|{kind:'region';rect:{x:number;y:number;w:number;h:number}}|{kind:'exit';at:Tile2}|{kind:'person';at:Tile2}
  |{kind:'thing';at:Feet;area?:string}|{kind:'area';at:Feet}|{kind:'starts';at:Feet;area?:string}|null;
type Confirmation={title:string;description:string;confirmLabel:string;run:()=>void};
/** The place shown on the map: the region that lays it, and the place (its file, its text as this editor knows it, its document and its scene's cast); or why it can't be shown. */
type Laid={region:PlaceRegion;error:string}|{region:PlaceRegion;origin:Tile2;path:string;text:string;place:PlaceDocument;cast:Array<{id:string;name:string}>};
const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');
const THING_GLYPHS:Record<string,string>={feature:'◆',object:'■',item:'•',creature:'¥',person:'☺'};

/** The editor for a map file. The host saves what it's handed; the editor's undo lasts while the file is open. */
export function MapApp({document:initial,host}:{document:MapDocument;host:FileHost<MapDocument>}){
  const [toast,setToast]=useState('');
  const campaign=useCampaignFiles(host,setToast);
  // What this editor has written to other files lately (a place, the scenario), until the campaign is read again with it.
  const {writer,textOf,version:wrote}=useWritten(host,campaign);
  const edits=useEdits<MapDocument>({host:writer,initial,shape:mapShapeOf,serialize:serializeMap,onError:setToast});
  const doc=edits.doc,key=keyOfPath(host.filePath);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(timer)},[toast]);
  // ---- The view ----
  const [mode,setMode]=useState<Mode>('edit'),[tool,setTool]=useState<Tool>('brush'),[brush,setBrush]=useState(1);
  const cells=useMemo(()=>cellsOf(doc.grid),[doc.grid]);
  const counts=useMemo(()=>usage(cells),[cells]);
  const [paintCh,setPaintCh]=useState(()=>pickDefault(initial,cellsOf(initial.grid),'paint'));
  const [eraseCh,setEraseCh]=useState(()=>pickDefault(initial,cellsOf(initial.grid),'erase'));
  const [slot,setSlot]=useState<'paint'|'erase'>('paint'),[filter,setFilter]=useState('');
  const [selection,setSelection]=useState<Selection>(null),[tab,setTab]=useState<'selected'|'map'|'place'|'problems'>('map');
  const [placeRegion,setPlaceRegion]=useState<number|null>(null),[showRegions,setShowRegions]=useState(true);
  const [menu,setMenu]=useState<{at:Tile2;x:number;y:number}|null>(null),[dialog,setDialog]=useState<DialogState>(null),[confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const [camera,setCamera]=useState<Tile2>({x:cells.width/2-.5,y:cells.height/2-.5}),[zoom,setZoom]=useState(1),[size,setSize]=useState({w:900,h:650});
  const [grid,setGrid]=useState(true),[time,setTime]=useState<TimeOfDay>('afternoon'),[roofs,setRoofs]=useState(false),[previewError,setPreviewError]=useState('');
  const [resizing,setResizing]=useState<Resize|null>(null),[regionDraft,setRegionDraft]=useState<{a:Tile2;b:Tile2}|null>(null),[dragged,setDragged]=useState<{key:string;tile:Tile2}|null>(null);
  const root=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null),overlay=useRef<HTMLDivElement>(null),menuRef=useRef<HTMLDivElement>(null),confirmFocus=useRef<HTMLElement|null>(null);
  const pixi=useRef<MapPixi|null>(null),stroke=useRef<MapStroke|null>(null),pan=useRef<{x:number;y:number;camera:Tile2}|null>(null),liveCamera=useRef(camera);
  const resizeDrag=useRef<{base:Cells;edge:MapEdge;x:number;y:number;unit:Tile2;result:Resize}|null>(null);
  const markerDrag=useRef<{key:string;from:Tile2;tile:Tile2;moved:boolean;drop:(tile:Tile2)=>void;click:()=>void}|null>(null);
  const previewTile=useRef<(x:number,y:number)=>Tile2|undefined>(()=>undefined);
  const hover=useMemo(()=>new MapHoverStore(),[]);
  const shown=resizing?.cells??cells;
  const unit=mode==='preview'?{x:12*zoom,y:12*zoom}:{x:18*zoom,y:9*zoom};
  const viewCamera={x:camera.x+(resizing?.offset.x??0),y:camera.y+(resizing?.offset.y??0)};
  const project=(p:{x:number;y:number})=>({x:size.w/2+(p.x-viewCamera.x+p.y-viewCamera.y)*unit.x,y:size.h*.56+(p.y-viewCamera.y-p.x+viewCamera.x)*unit.y});
  const tileFrom=(x:number,y:number):Tile2=>{if(mode==='edit')return mapTileAt({width:size.w,height:size.h,camera:liveCamera.current,zoom},x,y);return previewTile.current(x,y)??{x:-1,y:-1}};
  const stagePoint=(e:{clientX:number;clientY:number})=>{const box=stage.current!.getBoundingClientRect();return {x:e.clientX-box.left,y:e.clientY-box.top}};

  // ---- The campaign around the map: the scenario's scenes and maps, its start, the places its regions lay ----
  const scenario=campaign?.scenario;
  const scenarioText=textOf(campaign?.scenarioPath,campaign?.scenarioText);
  const scenarioDoc=useMemo(()=>{if(!scenarioText||!scenario)return scenario;try{return JSON.parse(scenarioText) as typeof scenario}catch{return scenario}},[scenarioText,scenario,wrote]);
  const listed=!!scenarioDoc?.maps.includes(doc.id);
  const atCampaignPath=!!campaign&&host.filePath===pathIn.map(campaign.root,doc.id);
  const start=scenarioDoc?.start.map===doc.id&&scenarioDoc.start.at?{x:scenarioDoc.start.at[0],y:scenarioDoc.start.at[1]}:undefined;
  const sceneTitle=(id:string)=>campaign?.scenes.find(scene=>scene.key===id)?.doc?.title??id;
  const choices={
    scenes:(scenarioDoc?.scenes??[]).map(id=>({value:id,label:`${sceneTitle(id)} (${id})`})) as Option[],
    maps:(scenarioDoc?.maps??[]).map(id=>({value:id,label:`${campaign?.maps.find(map=>map.key===id)?.doc?.title??id} (${id})`})) as Option[],
  };
  const otherMap=(id:string)=>id===doc.id?doc:campaign?.maps.find(map=>map.key===id)?.doc;

  // The place laid at the region shown: the region's scene's place, at its worldOrigin.
  const laid=useMemo<Laid|undefined>(()=>{
    if(placeRegion===null)return undefined;
    const region=doc.regions[placeRegion];
    if(!region?.sceneId||!region.worldOrigin)return undefined;
    const scene=campaign?.scenes.find(s=>s.key===region.sceneId);
    const placeKey=scene?.doc?.place;
    const file=placeKey?campaign?.places.find(p=>p.key===placeKey):undefined;
    if(!file?.doc)return {region,error:placeKey?`${region.sceneId}'s place ${placeKey} isn't one of the scenario's places, or doesn't open`:`${region.sceneId} has no place`};
    const text=textOf(file.path,file.text)??file.text??'';
    let place:PlaceDocument;
    try{place=JSON.parse(text)}catch{place=file.doc}
    const cast=(scene?.doc?.cast??[]).map(member=>({id:member.id,name:member.name||member.id}));
    return {region,origin:region.worldOrigin,path:file.path,text,place,cast};
  },[placeRegion,doc.regions,campaign,wrote]);
  const placeOf=laid&&!('error' in laid)?laid:undefined;

  // ---- Problems: the scenario format's rules for this map (and the place laid on it), on the map as it is now ----
  const problems=useMemo<CampaignProblem[]>(()=>{
    if(!campaign?.scenario||!listed)return [];
    const all=campaignProblems(withDraft(campaign,'map',doc.id,doc,serializeMap(doc)));
    return all.filter(problem=>problem.path===host.filePath||placeOf&&problem.path===placeOf.path);
  },[campaign,doc,listed,placeOf?.path]);
  const notes=[
    ...(!campaign?['Reading the campaign…']:[]),
    ...(campaign?.error?[`The campaign couldn't be read (${campaign.error}): its scenes, maps and start aren't offered.`]:[]),
    ...(campaign?.scenario&&!listed?[`${doc.id} isn't one of the scenario's maps (${campaign.scenarioPath}), so the game doesn't load it${atCampaignPath?': list it there to walk it.':` and couldn't: a campaign's map is maps/${doc.id}.kmmap, and this file is ${host.filePath}.`}`]:[]),
    ...(keyOfPath(host.filePath)!==doc.id?[`Its id is ${doc.id} and its file is named ${keyOfPath(host.filePath)}: a map's id is its file's name.`]:[]),
  ];

  // ---- Edits ----
  const commit=(next:MapDocument,coalesce=false)=>edits.commit(next,coalesce);
  const edit=(next:MapDocument)=>edits.commit(next,true);
  const writeOther=(changes:FileChange[],own?:MapDocument,coalesce=false)=>edits.write(changes,own,coalesce);
  /** The place laid on the map edited (its own file): a field typed in is one step of undo, as in this file. */
  const editPlace=(next:PlaceDocument,coalesce=false)=>{
    if(!placeOf)return;
    const problems=placeShapeOf(next);
    if(problems.length){setToast(`Not saved: the game couldn't load the place like that (${problems[0]}).`);return}
    const after=serializePlace(next);
    if(after!==placeOf.text)void writeOther([{path:placeOf.path,before:placeOf.text,after}],undefined,coalesce);
  };
  /** The story's start moved onto a tile of this map (and the map listed, if it's the campaign's and isn't yet). */
  const startHere=(at:Tile2)=>{
    if(!campaign?.scenarioPath||!scenarioDoc||!scenarioText){setToast('There\'s no scenario to start in: open the campaign folder as the vault.');return}
    if(!listed&&!atCampaignPath){setToast(`The story can only start on one of the campaign's maps (maps/${doc.id}.kmmap); this file is ${host.filePath}.`);return}
    let next=withStart(scenarioDoc,doc.id,at);
    if(!listed)next={...next,maps:[...next.maps,doc.id]};
    void writeOther([{path:campaign.scenarioPath,before:scenarioText,after:serializeScenario(next)}]);
  };
  const finish=(cancel=false)=>{
    const s=stroke.current;stroke.current=null;
    if(pan.current)setCamera({...liveCamera.current});
    pan.current=null;resizeDrag.current=null;setResizing(null);
    if(s){
      const accepted=!cancel&&s.changed&&commit(withCells(edits.current.current,s.draft));
      if(!accepted)pixi.current?.patch(s.base,s.touched);
      hover.update(hover.point,accepted?s.draft:s.base,doc.legend);
    }
    if(regionDraft&&!cancel){const r=rectOf(regionDraft.a,regionDraft.b);setDialog({kind:'region',rect:r})}
    setRegionDraft(null);
  };
  const choose=(ch:string)=>{finish();if(slot==='paint')setPaintCh(ch);else setEraseCh(ch);if(['sample','pan','resize','region'].includes(tool))setTool(slot==='erase'?'erase':'brush')};
  const chooseTool=(next:Tool)=>{finish();setTool(next);if(next==='erase')setSlot('erase');else if(['brush','rectangle','fill'].includes(next))setSlot('paint')};
  /** Something selected: shown in the inspector; a region that lays a scene's place shows the place on the map too. */
  const select=(next:Selection)=>{
    setSelection(next);if(next)setTab('selected');setMenu(null);
    if(next?.kind==='region'){const region=edits.current.current.regions[next.index];if(region?.sceneId&&region.worldOrigin)setPlaceRegion(next.index)}
  };
  const ask=(confirmation:Confirmation)=>{confirmFocus.current=(root.current?.ownerDocument.activeElement as HTMLElement|null)??null;setMenu(null);setConfirmation(confirmation)};
  const open=(path:string)=>void host.open(path).catch(error=>setToast(String(error instanceof Error?error.message:error)));

  // Removing, each after asking.
  const removeRegionAt=(index:number)=>{const region=doc.regions[index];ask({title:`Delete region ${region.name||region.id}?`,description:`This takes the region off the map${region.sceneId?`, and with it where ${region.sceneId} is played`:''}. Its scene's place file stays as it is. You can undo this.`,confirmLabel:'Delete region',run:()=>{if(commit(removeRegion(edits.current.current,index))){setSelection(null);if(placeRegion!==null)setPlaceRegion(placeRegion===index?null:placeRegion>index?placeRegion-1:placeRegion)}}})};
  const removeExitAt=(index:number)=>{const exit=doc.exits[index];ask({title:`Delete the exit “${exit.label}”?`,description:`The way from (${exit.at.x}, ${exit.at.y}) to ${exit.to.map} goes. You can undo this.`,confirmLabel:'Delete exit',run:()=>{if(commit(removeExits(edits.current.current,[index])))setSelection(null)}})};
  const removePersonAt=(index:number)=>{const person=doc.people![index];ask({title:`Delete ${person.name}?`,description:`${person.name} won't be about on the map. You can undo this.`,confirmLabel:'Delete',run:()=>{if(commit(removePerson(edits.current.current,index)))setSelection(null)}})};
  const removePlacePart=(part:PlacePart)=>{if(!placeOf)return;ask({title:'Remove from the place?',description:`Remove ${part.id} from ${placeOf.place.title||placeOf.place.id}? You can undo this.`,confirmLabel:'Remove',run:()=>{try{editPlace(removeFromPlace(placeOf.place,part.id));setSelection(null)}catch(error){setToast(String((error as Error).message))}}})};

  // ---- Resizing ----
  const applyResize=(result:Resize)=>{
    if(!result.amount)return;
    const before=edits.current.current;
    const {doc:resized,lost}=resizeMap(before,result);
    const run=()=>{
      const {offset}=result,changes:FileChange[]=[];
      if(offset.x||offset.y){
        // What other files say of this map's tiles moves with them: the story's start, and the exits that land here.
        if(start&&campaign?.scenarioPath&&scenarioDoc&&scenarioText)changes.push({path:campaign.scenarioPath,before:scenarioText,after:serializeScenario(withStart(scenarioDoc,doc.id,{x:start.x+offset.x,y:start.y+offset.y}))});
        for(const map of campaign?.maps??[]){
          if(map.key===doc.id||!map.doc||!map.text)continue;
          let other=map.doc;
          map.doc.exits.forEach((exit,i)=>{if(exit.to.map===doc.id)other=setExit(other,i,{...exit,to:{...exit.to,at:movedPoint(exit.to.at,{x:exit.to.at.x+offset.x,y:exit.to.at.y+offset.y})}})});
          if(other!==map.doc){const text=textOf(map.path,map.text)!;changes.push({path:map.path,before:text,after:serializeMap(other)})}
        }
      }
      if(changes.length)void writeOther(changes,resized).then(ok=>{if(ok)setCamera(c=>({x:c.x+offset.x,y:c.y+offset.y}))});
      else if(commit(resized))setCamera(c=>({x:c.x+offset.x,y:c.y+offset.y}));
    };
    if(result.removed||lost.length)ask({title:'Crop the map?',description:`This removes ${result.removed} tiles from the ${result.edge} edge, leaving a ${result.cells.width} × ${result.cells.height} map.${lost.length?` Off the map with them: ${lost.join(', ')}.`:''} A region partly off it is cut to what's left. You can undo this.`,confirmLabel:'Crop map',run});
    else run();
  };
  const resizeDown=(e:React.PointerEvent<HTMLButtonElement>,edge:MapEdge)=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();finish();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);const result=resizeCells(cells,edge,0,eraseCh);resizeDrag.current={base:cells,edge,x:e.clientX,y:e.clientY,unit:{...unit},result};setResizing(result)};
  const resizeMove=(e:React.PointerEvent<HTMLButtonElement>)=>{const r=resizeDrag.current;if(!r)return;const a=(e.clientX-r.x)/r.unit.x,b=(e.clientY-r.y)/r.unit.y,dx=(a-b)/2,dy=(a+b)/2;const horizontal=r.edge==='east'||r.edge==='west',length=horizontal?r.base.width:r.base.height,limit=horizontal?MAP_LIMIT.w:MAP_LIMIT.h;const amount=Math.max(MAP_MIN-length,Math.min(limit-length,Math.round(r.edge==='east'?dx:r.edge==='west'?-dx:r.edge==='south'?dy:-dy)));if(amount===r.result.amount)return;r.result=resizeCells(r.base,r.edge,amount,eraseCh);setResizing(r.result)};
  const resizeUp=(e:React.PointerEvent<HTMLButtonElement>)=>{const r=resizeDrag.current;resizeDrag.current=null;setResizing(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(r)applyResize(r.result)};

  // ---- The renderers ----
  useEffect(()=>{const el=stage.current;if(!el)return;const observer=new ResizeObserver(()=>setSize({w:el.clientWidth,h:el.clientHeight}));observer.observe(el);return()=>observer.disconnect()},[mode]);
  useEffect(()=>{const el=canvas.current;if(!el)return;const wheel=(e:WheelEvent)=>{e.preventDefault();if(!resizeDrag.current)setZoom(z=>Math.max(.15,Math.min(3,z*Math.exp(-e.deltaY*.001))))};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)},[mode]);
  const latest=useRef({shown,legend:doc.legend,grid,view:{width:size.w,height:size.h,camera:viewCamera,zoom}});
  latest.current={shown:stroke.current?.draft??shown,legend:doc.legend,grid,view:{width:size.w,height:size.h,camera:viewCamera,zoom}};
  useEffect(()=>{
    if(mode!=='edit'||!canvas.current)return;
    const renderer=new MapPixi(canvas.current);pixi.current=renderer;let closed=false;
    void renderer.init().then(()=>{
      if(closed)return;const now=latest.current;renderer.setMap(now.shown,now.legend,now.grid);renderer.setView(now.view);setPreviewError('');
    }).catch(e=>{if(!closed)setPreviewError('The map renderer is unavailable: '+String(e))});
    return()=>{closed=true;renderer.destroy();if(pixi.current===renderer)pixi.current=null};
  },[mode]);
  useEffect(()=>{if(mode==='edit')pixi.current?.setMap(shown,doc.legend,grid);hover.update(hover.point,shown,doc.legend)},[shown,doc.legend,grid,mode]);
  useLayoutEffect(()=>{
    liveCamera.current=camera;
    if(overlay.current)overlay.current.style.transform='';
    if(mode==='edit')pixi.current?.setView({width:size.w,height:size.h,camera:viewCamera,zoom});
  },[camera,size,zoom,resizing,mode]);
  useEffect(()=>{if(mode==='edit')pixi.current?.setHover(tool==='pan'||tool==='resize'?null:hover.point,tool==='brush'||tool==='erase'?brush:1)},[tool,brush,mode,shown]);
  const game=useMemo(()=>{if(mode!=='preview')return null;try{return compileMap(doc,time)}catch(error){return {error:String(error instanceof Error?error.message:error)}}},[mode,doc,time]);
  useEffect(()=>{
    const el=canvas.current;if(!el||mode!=='preview'||!game||size.w<1||size.h<1)return;
    if('error' in game){setPreviewError(`Preview unavailable: ${game.error}`);return}
    const ctx=el.getContext('2d');if(!ctx)return;
    const dpr=window.devicePixelRatio||1;el.width=Math.round(size.w*dpr);el.height=Math.round(size.h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#151619';ctx.fillRect(0,0,size.w,size.h);
    const cw=6*zoom,ch=12*zoom,w=Math.min(500,Math.ceil(size.w/cw)),h=Math.min(260,Math.ceil(size.h/ch));
    const ox=(size.w-w*cw)/2,oy=(size.h-h*ch)*.56;
    try{
      const frame=preview(game.map,game.actors,camera,{w,h},time,roofs);
      previewTile.current=(x,y)=>frame.at(Math.floor((x-ox)/cw),Math.floor((y-oy)/ch));setPreviewError('');ctx.textBaseline='top';
      frame.lines.forEach((spans,y)=>{let x=0;for(const span of spans){ctx.font=`${span.bold?'bold ':''}${ch}px monospace`;for(const char of span.text){if(span.bg){ctx.fillStyle=span.bg;ctx.fillRect(ox+x*cw,oy+y*ch,cw+.3,ch+.3)}if(char!==' '){ctx.fillStyle=span.fg||'#d4d0c4';ctx.fillText(char,ox+x*cw,oy+y*ch,cw)}x++}}});
    }catch(e){previewTile.current=()=>undefined;setPreviewError(`Preview unavailable: ${String(e)}`)}
  },[game,mode,size,camera,zoom,time,roofs]);

  // ---- Pointer and keys on the canvas ----
  const setHover=(point:Tile2|null)=>{hover.update(point,stroke.current?.draft??shown,doc.legend);if(mode==='edit')pixi.current?.setHover(tool==='pan'||tool==='resize'?null:point,tool==='brush'||tool==='erase'?brush:1)};
  const local=(e:React.PointerEvent<HTMLCanvasElement>)=>{const box=e.currentTarget.getBoundingClientRect();return {x:e.clientX-box.left,y:e.clientY-box.top}};
  const down=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(e.button!==0&&e.button!==1&&e.button!==2)return;e.preventDefault();e.currentTarget.focus();
    setMenu(null);if(e.button===2||mode==='edit'&&e.currentTarget.dataset.renderer!=='pixi')return;
    const pos=local(e),p=tileFrom(pos.x,pos.y);
    e.currentTarget.setPointerCapture(e.pointerId);
    if(mode==='preview'||tool==='pan'||tool==='resize'||e.button!==0){pan.current={x:e.clientX,y:e.clientY,camera:{...liveCamera.current}};setHover(null);return}
    const m=cells;if(!inside(m,p))return;
    if(tool==='region'){setRegionDraft({a:p,b:p});return}
    if(tool==='sample'||e.altKey){const ch=cellAt(m,p);if(slot==='erase')setEraseCh(ch);else setPaintCh(ch);if(tool==='sample')setTool(slot==='erase'?'erase':'brush');return}
    // One material a gesture, so letting go of a key mid-stroke never mixes them.
    const ch=tool==='erase'||e.ctrlKey||e.metaKey?eraseCh:paintCh;
    if(tool==='fill'){const next=fill(m,p,ch);if(!sameCells(m,next))commit(withCells(edits.current.current,next));return}
    const s=new MapStroke(m,p,ch,brush,tool==='rectangle');stroke.current=s;
    pixi.current?.patch(s.draft,s.move(p));setHover(p);
  };
  const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(pan.current){
      const a=(e.clientX-pan.current.x)/unit.x,b=(e.clientY-pan.current.y)/unit.y;
      const next={x:pan.current.camera.x-(a-b)/2,y:pan.current.camera.y-(a+b)/2};liveCamera.current=next;
      if(mode==='edit'){
        pixi.current?.setView({width:size.w,height:size.h,camera:next,zoom});
        const dx=(camera.x-next.x+camera.y-next.y)*unit.x,dy=(camera.x-next.x-camera.y+next.y)*-unit.y;
        if(overlay.current)overlay.current.style.transform=`translate(${dx}px,${dy}px)`;
        e.currentTarget.dataset.cameraX=String(next.x);e.currentTarget.dataset.cameraY=String(next.y);
      }else setCamera(next);
      return;
    }
    const pos=local(e),p=tileFrom(pos.x,pos.y);
    if(regionDraft){if(p.x!==regionDraft.b.x||p.y!==regionDraft.b.y)setRegionDraft({...regionDraft,b:{x:Math.max(0,Math.min(cells.width-1,p.x)),y:Math.max(0,Math.min(cells.height-1,p.y))}})}
    const s=stroke.current;
    if(s){const changed=s.move(p);if(changed.size)pixi.current?.patch(s.draft,changed)}
    setHover(mode==='preview'?previewTile.current(pos.x,pos.y)??null:p);
  };
  const openMenu=(e:React.MouseEvent,at?:Tile2)=>{
    e.preventDefault();e.stopPropagation();if(mode!=='edit'||!stage.current)return;finish();
    const point=stagePoint(e),tile=at??tileFrom(point.x,point.y);
    if(inside(cells,tile))setMenu({at:tile,x:Math.max(0,Math.min(point.x,size.w-280)),y:Math.max(0,Math.min(point.y,size.h-360))});else setMenu(null);
  };
  useEffect(()=>{if(menu)menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()},[menu]);
  const fit=()=>{const m=edits.current.current,c=cellsOf(m.grid);setCamera({x:c.width/2-.5,y:c.height/2-.5});setZoom(Math.max(.15,Math.min(2,Math.min((size.w-90)/((c.width+c.height)*(mode==='preview'?12:18)),(size.h-90)/((c.width+c.height)*(mode==='preview'?12:9))))))};
  const switchMode=(next:Mode)=>{finish();setMenu(null);setHover(null);setMode(next)};
  const deleteSelection=()=>{
    if(!selection)return;
    if(selection.kind==='region')removeRegionAt(selection.index);
    else if(selection.kind==='exit')removeExitAt(selection.index);
    else if(selection.kind==='person')removePersonAt(selection.index);
    else if(selection.kind==='place')removePlacePart(selection.part);
    else if(selection.kind==='legend')setDialog({kind:'unlegend',ch:selection.ch});
  };

  // ---- Markers: what stands on the map, each a button to select, drag to move, right-click for its tile's menu ----
  const markerDown=(e:React.PointerEvent<HTMLButtonElement>,key:string,from:Tile2,drop:(tile:Tile2)=>void,click:()=>void)=>{
    if(e.button!==0)return;e.stopPropagation();e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    markerDrag.current={key,from,tile:from,moved:false,drop,click};
  };
  const markerMove=(e:React.PointerEvent<HTMLButtonElement>)=>{
    const drag=markerDrag.current;if(!drag)return;
    const p=stagePoint(e),tile=tileFrom(p.x,p.y);
    if(!inside(cells,tile)||tile.x===drag.tile.x&&tile.y===drag.tile.y)return;
    drag.tile=tile;drag.moved=true;setDragged({key:drag.key,tile});
  };
  const markerUp=(e:React.PointerEvent<HTMLButtonElement>)=>{
    const drag=markerDrag.current;markerDrag.current=null;setDragged(null);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(!drag)return;
    if(drag.moved&&(drag.tile.x!==drag.from.x||drag.tile.y!==drag.from.y))drag.drop(drag.tile);else drag.click();
  };
  const markerKeys=(key:string,from:Tile2,drop:(tile:Tile2)=>void,click:()=>void)=>({
    onPointerDown:(e:React.PointerEvent<HTMLButtonElement>)=>markerDown(e,key,from,drop,click),onPointerMove:markerMove,onPointerUp:markerUp,
    onPointerCancel:()=>{markerDrag.current=null;setDragged(null)},onKeyDown:(e:React.KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();click()}},
    onContextMenu:(e:React.MouseEvent)=>openMenu(e,from),
  });
  const at=(key:string,tile:Tile2)=>dragged?.key===key?dragged.tile:tile;
  const markers:React.ReactNode[]=[];
  if(mode==='edit'&&tool!=='resize'){
    doc.exits.forEach((exit,index)=>{const k=`exit:${index}`,p=project(at(k,exit.at));markers.push(<button key={k} className={`map-marker map-marker-exit${selection?.kind==='exit'&&selection.index===index?' chosen':''}`} style={{left:p.x,top:p.y}} title={`${exit.label} → ${exit.to.map} (${exit.to.at.x}, ${exit.to.at.y})`} aria-label={`Exit ${exit.label} at ${exit.at.x}, ${exit.at.y}`} {...markerKeys(k,exit.at,tile=>void commit(setExit(edits.current.current,index,{...exit,at:tile})),()=>select({kind:'exit',index}))}>⇥</button>)});
    (doc.people??[]).forEach((person,index)=>{const k=`person:${index}`,p=project(at(k,person.at));markers.push(<button key={k} className={`map-marker map-marker-person${selection?.kind==='person'&&selection.index===index?' chosen':''}`} style={{left:p.x,top:p.y,color:person.color??'#b8ad9c'}} title={`${person.name} (${person.times.join(', ')})`} aria-label={`Person ${person.name} at ${person.at.x}, ${person.at.y}`} {...markerKeys(k,person.at,tile=>void commit(setPersonField(edits.current.current,index,'at',movedPoint(person.at,tile))),()=>select({kind:'person',index}))}>{person.glyph}</button>)});
    if(start){const p=project(at('start',start));markers.push(<button key="start" className={`map-marker map-marker-start${selection?.kind==='start'?' chosen':''}`} style={{left:p.x,top:p.y}} title="The story starts here" aria-label={`The story's start at ${start.x}, ${start.y}`} {...markerKeys('start',start,tile=>startHere(tile),()=>select({kind:'start'}))}><Flag size={13}/></button>)}
    if(placeOf){
      const {origin,place}=placeOf;
      for(const thing of place.things){
        if(!thing.at)continue;
        const k=`thing:${thing.id}`,tile={x:origin.x+Math.floor(thing.at[0]/FEET_PER_TILE),y:origin.y+Math.floor(thing.at[1]/FEET_PER_TILE)};
        const spot=dragged?.key===k?{x:dragged.tile.x,y:dragged.tile.y}:{x:origin.x-.5+thing.at[0]/FEET_PER_TILE,y:origin.y-.5+thing.at[1]/FEET_PER_TILE};
        const p=project(spot);
        const chosen=selection?.kind==='place'&&selection.part.id===thing.id;
        markers.push(<button key={k} className={`map-marker map-marker-thing${chosen?' chosen':''}`} style={{left:p.x,top:p.y}} title={`${thing.name} (${thing.id})`} aria-label={`Thing ${thing.name}`} data-thing={thing.id} {...markerKeys(k,tile,target=>editPlace(moveThing(place,thing.id,feetMoved(origin,thing.at!,target))),()=>select({kind:'place',part:{kind:'thing',id:thing.id}}))}>{THING_GLYPHS[thing.kind??'']??'◇'}</button>);
      }
      for(const [id,person] of Object.entries(place.people)){
        const look=id==='player'?{glyph:'@',fg:'#f0e6c8'}:campaign?.looks[id]??{};
        const k=`starts:${id}`,feet=person.at??[place.areas.find(a=>a.id===person.in)?.rect.x??0,place.areas.find(a=>a.id===person.in)?.rect.y??0] as Feet;
        const tile={x:origin.x+Math.floor(feet[0]/FEET_PER_TILE),y:origin.y+Math.floor(feet[1]/FEET_PER_TILE)};
        const spot=dragged?.key===k?dragged.tile:{x:origin.x-.5+feet[0]/FEET_PER_TILE,y:origin.y-.5+feet[1]/FEET_PER_TILE};
        const p=project(spot),chosen=selection?.kind==='place'&&selection.part.id===id;
        markers.push(<button key={k} className={`map-marker map-marker-cast${chosen?' chosen':''}`} style={{left:p.x,top:p.y,color:look.fg??'#e8dcc0'}} title={`${id} starts here${person.note?`: ${person.note}`:''}`} aria-label={`${id} starts here`} data-starts={id} {...markerKeys(k,tile,target=>editPlace(movePerson(place,id,person.at?feetMoved(origin,person.at,target):feetOfTile(origin,target))),()=>select({kind:'place',part:{kind:'person',id}}))}>{look.glyph??id.charAt(0).toUpperCase()}</button>);
      }
    }
  }
  const diamond=(x:number,y:number,w:number,h:number)=>[project({x:x-.5,y:y-.5}),project({x:x+w-.5,y:y-.5}),project({x:x+w-.5,y:y+h-.5}),project({x:x-.5,y:y+h-.5})].map(p=>`${p.x},${p.y}`).join(' ');
  const shapes:React.ReactNode[]=[];
  if(mode==='edit'&&tool!=='resize'){
    if(showRegions)doc.regions.forEach((region,index)=>{const r=region.rect,chosen=selection?.kind==='region'&&selection.index===index;if(!chosen&&!showRegions)return;shapes.push(<polygon key={`region:${index}`} className={`map-region${chosen?' chosen':''}${region.sceneId?' plays':''}`} points={diamond(r.x,r.y,r.w,r.h)} data-region={region.id}/>)});
    if(regionDraft){const r=rectOf(regionDraft.a,regionDraft.b);shapes.push(<polygon key="draft" className="map-region draft" points={diamond(r.x,r.y,r.w,r.h)}/>)}
    if(placeOf){
      const {origin,place}=placeOf,t=tilesOf(place.size);
      shapes.push(<polygon key="place" className="map-place" points={diamond(origin.x,origin.y,t.w,t.h)}/>);
      for(const area of place.areas){const r=area.rect,chosen=selection?.kind==='place'&&selection.part.id===area.id;shapes.push(<polygon key={`area:${area.id}`} className={`map-area${chosen?' chosen':''}`} points={diamond(origin.x+r.x/FEET_PER_TILE,origin.y+r.y/FEET_PER_TILE,r.w/FEET_PER_TILE,r.h/FEET_PER_TILE)} data-area={area.id}/>)}
    }
  }
  const areaChips:React.ReactNode[]=[];
  if(placeOf&&mode==='edit'&&tool!=='resize'){
    const {origin,place}=placeOf;
    for(const area of place.areas){
      const k=`area:${area.id}`,corner={x:origin.x+Math.floor(area.rect.x/FEET_PER_TILE),y:origin.y+Math.floor(area.rect.y/FEET_PER_TILE)};
      const spot=dragged?.key===k?dragged.tile:{x:origin.x-.5+area.rect.x/FEET_PER_TILE,y:origin.y-.5+area.rect.y/FEET_PER_TILE};
      const p=project(spot),chosen=selection?.kind==='place'&&selection.part.id===area.id;
      areaChips.push(<button key={k} className={`map-area-chip${chosen?' chosen':''}`} style={{left:p.x,top:p.y}} aria-label={`Area ${area.name}`} data-area={area.id} {...markerKeys(k,corner,target=>{const moved=feetMoved(origin,[area.rect.x,area.rect.y],target);editPlace(moveArea(place,area.id,moved[0],moved[1]))},()=>select({kind:'place',part:{kind:'area',id:area.id}}))}>{area.name||area.id}</button>);
    }
  }

  // ---- The tile's menu ----
  const tileMenu=()=>{
    if(!menu)return null;
    const here=thingsAt(doc,menu.at),entry=doc.legend[cellAt(cells,menu.at)];
    const place=placeOf?.place,origin=placeOf?.origin,feet=origin?feetOfTile(origin,menu.at):undefined;
    const area=place&&feet?areaAt(place,feet):undefined;
    const onPlace=place&&origin?[...place.things.filter(t=>t.at&&origin.x+Math.floor(t.at[0]/FEET_PER_TILE)===menu.at.x&&origin.y+Math.floor(t.at[1]/FEET_PER_TILE)===menu.at.y).map(t=>({kind:'thing' as const,id:t.id,name:t.name})),...Object.entries(place.people).filter(([,p])=>p.at&&origin.x+Math.floor(p.at[0]/FEET_PER_TILE)===menu.at.x&&origin.y+Math.floor(p.at[1]/FEET_PER_TILE)===menu.at.y).map(([id])=>({kind:'person' as const,id,name:id}))]:[];
    const item=(label:string,run:()=>void,danger=false)=><button key={label} role="menuitem" className={danger?'danger':''} onClick={()=>{setMenu(null);run()}}>{label}</button>;
    return <div className="map-context-menu" ref={menuRef} role="menu" aria-label={`Tile ${menu.at.x}, ${menu.at.y}`} style={{left:menu.x,top:menu.y}} onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll('button')),i=buttons.indexOf(e.currentTarget.ownerDocument.activeElement as HTMLButtonElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus()}}}>
      <small>Tile {menu.at.x}, {menu.at.y} · {entryName(entry)}{cellAt(cells,menu.at)!==VOID?` “${cellAt(cells,menu.at)}”`:''}</small>
      {here.regions.map(({region,index})=><React.Fragment key={`r${index}`}>{item(`Edit region ${region.name||region.id}…`,()=>select({kind:'region',index}))}{item(`Delete region ${region.name||region.id}…`,()=>removeRegionAt(index),true)}</React.Fragment>)}
      {here.exits.map(({exit,index})=><React.Fragment key={`e${index}`}>{item(`Edit exit ${exit.label}…`,()=>select({kind:'exit',index}))}{item(`Delete exit ${exit.label}…`,()=>removeExitAt(index),true)}</React.Fragment>)}
      {here.people.map(({person,index})=><React.Fragment key={`p${index}`}>{item(`Edit ${person.name}…`,()=>select({kind:'person',index}))}{item(`Delete ${person.name}…`,()=>removePersonAt(index),true)}</React.Fragment>)}
      {onPlace.map(part=><React.Fragment key={`t${part.id}`}>{item(`Edit ${part.name}…`,()=>select({kind:'place',part}))}{item(`Remove ${part.name} from the place…`,()=>removePlacePart(part),true)}</React.Fragment>)}
      {item('Add region here…',()=>setDialog({kind:'region',rect:{x:menu.at.x,y:menu.at.y,w:1,h:1}}))}
      {item('Add exit here…',()=>setDialog({kind:'exit',at:menu.at}))}
      {item('Add person here…',()=>setDialog({kind:'person',at:menu.at}))}
      {item('Start the story here',()=>startHere(menu.at))}
      {place&&feet&&<>
        {item(`Add a thing of ${place.title||place.id} here…`,()=>setDialog({kind:'thing',at:feet,area:area?.id}))}
        {item(`Add an area of ${place.title||place.id} here…`,()=>setDialog({kind:'area',at:feet}))}
        {item('Start someone of the scene here…',()=>setDialog({kind:'starts',at:feet,area:area?.id}))}
      </>}
    </div>;
  };

  // ---- The inspector ----
  const regionPlaceNote=(index:number)=>{
    const region=doc.regions[index];
    if(!region?.sceneId)return undefined;
    if(region.worldOrigin){const scene=campaign?.scenes.find(s=>s.key===region.sceneId);return scene?.doc?.place?`Its place is ${scene.doc.place} (places/${scene.doc.place}.kmplace).`:`${region.sceneId} has no place of its own.`}
    const layer=campaign?.maps.flatMap(map=>(map.key===doc.id?doc:map.doc)?.regions.filter(r=>r.sceneId===region.sceneId&&r.worldOrigin).map(r=>`${r.id} on ${map.key}`)??[]);
    return layer?.length?`It opens ${region.sceneId}, whose place is laid by ${layer.join(', ')}.`:`It opens ${region.sceneId}, but no region lays its place.`;
  };
  const inspector=()=>{
    if(tab==='map')return <MapPanel doc={doc} onChange={edit} select={next=>select(next)} start={start}/>;
    if(tab==='place'&&placeOf)return <PlacePanel doc={placeOf.place} path={placeOf.path} openFile={()=>open(placeOf.path)} onChange={next=>editPlace(next,true)} onSelect={part=>select({kind:'place',part})}/>;
    if(tab==='problems')return <div className="problems-panel">
      {notes.map(note=><p className="problems-note" key={note}><Info size={14}/>{note}</p>)}
      {listed&&(problems.length?<p className="muted">The campaign check would refuse the campaign for {problems.length===1?'this':`these ${problems.length}`}.</p>:<p className="problems-clear"><CheckCircle2 size={15}/>No problems: the campaign check finds nothing in this map{placeOf?' or the place laid on it':''}.</p>)}
      <ol className="problems">{problems.map((problem,i)=><li key={`${i}:${problem.message}`}><button type="button" className="problem" onClick={()=>goTo(problem)}><AlertTriangle size={14}/><span><b>{problem.message}</b><small>{problem.file}</small></span></button></li>)}</ol>
    </div>;
    const s=selection;
    if(!s)return <p className="info-box">Right-click a tile to add a region, an exit or someone about, or to start the story there. Click a marker, or a region in the Map tab, to edit it here. Select a region that lays a scene's place to show the place on the map.</p>;
    if(s.kind==='region')return <RegionInspector key={`region:${s.index}`} doc={doc} index={s.index} choices={choices} onChange={edit} onRemove={()=>removeRegionAt(s.index)} shown={placeRegion===s.index} onShowPlace={doc.regions[s.index]?.sceneId&&doc.regions[s.index]?.worldOrigin?()=>{const showing=placeRegion===s.index;setPlaceRegion(showing?null:s.index);if(!showing)setTab('place')}:undefined} placeNote={regionPlaceNote(s.index)}/>;
    if(s.kind==='exit')return <ExitInspector key={`exit:${s.index}`} doc={doc} index={s.index} choices={choices} onChange={edit} onRemove={()=>removeExitAt(s.index)} onOpen={map=>open(pathIn.map(campaign?.root??'',map))}/>;
    if(s.kind==='person')return <PersonInspector key={`person:${s.index}`} doc={doc} index={s.index} onChange={edit} onRemove={()=>removePersonAt(s.index)}/>;
    if(s.kind==='legend'){const entry=doc.legend[s.ch];return entry?<LegendInspector key={`legend:${s.ch}`} ch={s.ch} entry={entry} uses={counts.get(s.ch)??0} onChange={next=>edit(setLegendEntry(edits.current.current,s.ch,next))} onRemove={()=>setDialog({kind:'unlegend',ch:s.ch})} onPaint={()=>{setPaintCh(s.ch);setSlot('paint');setTool('brush')}}/>:<p className="muted">That entry isn't in the legend any more.</p>}
    if(s.kind==='start')return <div className="start-inspector"><p className="inspector-kind"><Flag size={13}/>The story's start{start&&<code>{start.x}, {start.y}</code>}</p><p className="muted">{start?`Day ${scenarioDoc?.start.day}, ${scenarioDoc?.start.time}: the player starts walking here, on ${doc.title}. Drag the flag to move it; the scenario's start moves with it.`:'The story doesn\'t start on this map.'}</p>{campaign?.scenarioPath&&<button type="button" className="text-button" onClick={()=>open(campaign.scenarioPath!)}>Open the scenario</button>}</div>;
    if(s.kind==='place'&&placeOf)return <PlacePartInspector key={`${s.part.kind}:${s.part.id}`} part={s.part} doc={placeOf.place} onChange={next=>editPlace(next,true)} onSelect={part=>part?select({kind:'place',part}):setSelection(null)} confirm={(title,description,label,run)=>ask({title,description,confirmLabel:label,run})} cast={placeOf.cast}/>;
    return <p className="muted">Nothing to show.</p>;
  };
  const goTo=(problem:CampaignProblem)=>{
    const where=problem.at;
    if(where.kind==='map'){
      if(where.region!==undefined){const index=doc.regions.findIndex(r=>r.id===where.region);if(index>=0)return select({kind:'region',index})}
      if(where.exit!==undefined)return select({kind:'exit',index:where.exit});
      if(where.person!==undefined)return select({kind:'person',index:where.person});
      if(where.legend!==undefined)return select({kind:'legend',ch:where.legend});
      setTab('map');return;
    }
    if(where.kind==='place'&&placeOf){const id=where.thing??where.area??where.person;if(id)return select({kind:'place',part:{kind:where.thing?'thing':where.area?'area':'person',id}})}
    open(problem.path);
  };

  // ---- Keys: scoped to this editor, never while typing ----
  const onKeyDown=(e:React.KeyboardEvent)=>{
    if(confirmation||dialog||editable(e.target))return;
    if(menu){if(e.key==='Escape'){setMenu(null);canvas.current?.focus();e.preventDefault()}return}
    if(e.key==='Escape'){finish(true);setRegionDraft(null);e.preventDefault();return}
    if(resizeDrag.current||markerDrag.current){e.preventDefault();return}
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();if(e.key.toLowerCase()==='y'||e.shiftKey)void edits.redo();else void edits.undo();return}
    if(e.target instanceof Element&&e.target.closest('.map-inspector,.map-palette'))return;
    if(e.key==='Tab'&&(e.target===canvas.current||e.target===root.current)){e.preventDefault();e.stopPropagation();switchMode(mode==='edit'?'preview':'edit');return}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='Delete'||e.key==='Backspace'){if(selection){deleteSelection();e.preventDefault()}return}
    const key=e.key.toUpperCase(),chosen=TOOLS.find(t=>t.key===key);
    if(chosen){chooseTool(chosen.id);e.preventDefault()}
    else if(key==='X'){finish();setPaintCh(eraseCh);setEraseCh(paintCh);e.preventDefault()}
    else if(key==='F'){fit();e.preventDefault()}
    else if(key==='['||key===']'){setBrush(v=>Math.max(1,Math.min(5,v+(key===']'?1:-1))));e.preventDefault()}
  };

  // ---- The page ----
  const entries=Object.entries(doc.legend);
  const shownEntries=entries.filter(([ch,entry])=>!filter.trim()||`${ch} ${entryName(entry)} ${entry.terrain} ${entry.style??''}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const slotEntry=(ch:string)=>({name:ch===VOID?'Void':entryName(doc.legend[ch]),swatch:swatchOf(doc.legend[ch])});
  const bounds=[{x:-.5,y:-.5},{x:shown.width-.5,y:-.5},{x:shown.width-.5,y:shown.height-.5},{x:-.5,y:shown.height-.5}].map(project);
  const handles:Array<{edge:MapEdge;at:Tile2;dx:number;dy:number;icon:string}>=[
    {edge:'north',at:{x:(shown.width-1)/2,y:-.5},dx:-1,dy:-1,icon:'↖'},{edge:'east',at:{x:shown.width-.5,y:(shown.height-1)/2},dx:1,dy:-1,icon:'↗'},
    {edge:'south',at:{x:(shown.width-1)/2,y:shown.height-.5},dx:1,dy:1,icon:'↘'},{edge:'west',at:{x:-.5,y:(shown.height-1)/2},dx:-1,dy:1,icon:'↙'},
  ];
  const tabs:[typeof tab,string,number|undefined][]=[['selected','Selected',undefined],['map','Map',undefined],...(placeOf?[['place','Place',undefined] as [typeof tab,string,undefined]]:[]),['problems','Problems',campaign&&listed?problems.length:undefined]];
  const takenRegions=[...regionIds(campaign?.maps??[],doc.id),...doc.regions.map(r=>r.id)];
  return <EditSession.Provider value={edits.sessionHandlers}><div className="km-workshop km-forms km-map" ref={root} tabIndex={-1} data-campaign={campaign?'read':'reading'} onPointerDown={e=>{if(menu&&!(e.target as HTMLElement).closest('.map-context-menu'))setMenu(null)}} onKeyDown={onKeyDown}>
    <div className="map-body" inert={!!confirmation||!!dialog||undefined}>
      <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">{edits.busy?'Saving…':'Autosaves to this file'}</span></header>
      <div className="map-heading">
        <div><div className="eyebrow">KINGMAKER · MAP · <code>{doc.id}</code></div><h1>{doc.title||doc.id}</h1></div>
        <nav aria-label="Map views"><button aria-pressed={mode==='edit'} onClick={()=>switchMode('edit')}>Paint</button><button aria-pressed={mode==='preview'} onClick={()=>switchMode('preview')}>Game preview <kbd>Tab</kbd></button></nav>
      </div>
      <div className="map-toolbar">
        <div>{mode==='edit'?TOOLS.map(t=><button key={t.id} aria-label={t.name} title={`${t.name} (${t.key})`} aria-pressed={tool===t.id} onClick={()=>chooseTool(t.id)}><span>{t.icon}</span>{t.name}<kbd>{t.key}</kbd></button>):<span className="map-hint">The game's own renderer: the map as it's walked, read-only</span>}</div>
        <div><button aria-label="Undo map edit" disabled={!edits.canUndo||edits.busy} onClick={()=>void edits.undo()}>↶ Undo</button><button aria-label="Redo map edit" disabled={!edits.canRedo||edits.busy} onClick={()=>void edits.redo()}>↷ Redo</button></div>
      </div>
      <div className="map-content">
        <aside className="map-palette">
          {mode==='edit'?<>
            <div className="map-paint-pair" role="group" aria-label="Paint and erase materials">
              {(['paint','erase'] as const).map(which=>{const ch=which==='paint'?paintCh:eraseCh,look=slotEntry(ch);return <button key={which} className="map-material-slot" aria-label={`Choose ${which} material`} aria-pressed={slot===which} onClick={()=>{finish();setSlot(which);if(which==='paint'&&tool==='erase')setTool('brush')}}><span style={{background:look.swatch}}/><span><small>{which.toUpperCase()}</small><strong>{ch===VOID?'':`“${ch}” `}{look.name}</strong></span></button>})}
              <button className="map-swap-materials" aria-label="Swap paint and erase materials" title="Swap materials (X)" onClick={()=>{finish();setPaintCh(eraseCh);setEraseCh(paintCh)}}>⇄ Swap <kbd>X</kbd></button>
              <small>Click a slot, then an entry below. Ctrl/Cmd-drag paints with Erase.</small>
            </div>
            <div className="map-legend-head"><div className="eyebrow">LEGEND · {entries.length}</div><button className="map-new-entry" onClick={()=>setDialog({kind:'legend'})}><Plus size={13}/>New entry</button></div>
            {entries.length>10&&<input className="map-legend-filter" aria-label="Filter the legend" placeholder="Filter…" value={filter} onChange={e=>setFilter(e.target.value)}/>}
            <div className="map-materials" role="list" aria-label="Legend">
              {shownEntries.map(([ch,entry])=><div key={ch} className="map-material" role="listitem">
                <button className="map-material-choose" aria-label={`${slot==='paint'?'Paint':'Erase'} “${ch}” ${entryName(entry)}`} aria-pressed={(slot==='paint'?paintCh:eraseCh)===ch} onClick={()=>choose(ch)}><span style={{background:swatchOf(entry)}}/><code>{ch}</code><span className="name" title={entryName(entry)}>{entryName(entry)}</span><small>{counts.get(ch)??0}</small></button>
                <button className="map-material-edit" aria-label={`Edit legend entry “${ch}”`} title="Edit this entry" onClick={()=>select({kind:'legend',ch})}><Pencil size={12}/></button>
              </div>)}
              <div className="map-material" role="listitem"><button className="map-material-choose" aria-label={`${slot==='paint'?'Paint':'Erase'} the void`} aria-pressed={(slot==='paint'?paintCh:eraseCh)===VOID} onClick={()=>choose(VOID)}><span style={{background:swatchOf(undefined)}}/><code>␣</code><span className="name">Void (no tile)</span><small>{counts.get(VOID)??0}</small></button></div>
            </div>
            <label>Brush size <strong>{brush} × {brush}</strong><input aria-label="Brush size" type="range" min="1" max="5" value={brush} onChange={e=>setBrush(Number(e.target.value))}/></label>
            <label className="map-check"><input type="checkbox" checked={grid} onChange={e=>setGrid(e.target.checked)}/>Show tile edges</label>
            <label className="map-check"><input type="checkbox" checked={showRegions} onChange={e=>setShowRegions(e.target.checked)}/>Show regions</label>
          </>:<>
            <label className="field-label" htmlFor="km-preview-time">Time of day</label>
            <select id="km-preview-time" aria-label="Time of day" value={time} onChange={e=>setTime(e.target.value as TimeOfDay)}>{TIMES.map(t=><option key={t} value={t}>{t.replace('-',' ')}</option>)}</select>
            <label className="map-check"><input type="checkbox" checked={roofs} onChange={e=>setRoofs(e.target.checked)}/>Lift roofs</label>
            <p>The game's isometric renderer, on this map as the game builds it: its legend's tiles and decor, and the people about at this hour.</p>
          </>}
        </aside>
        <div className="map-stage" ref={stage}>
          <canvas key={mode} ref={canvas} tabIndex={0} aria-label={mode==='edit'?'Isometric map painter':'Isometric game preview'} data-mode={mode} data-camera-x={camera.x} data-camera-y={camera.y} data-zoom={zoom} data-width={shown.width} data-height={shown.height}
            onPointerDown={down} onPointerMove={move} onPointerUp={e=>{finish();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish()} onPointerLeave={()=>{if(!stroke.current)setHover(null)}} onContextMenu={e=>openMenu(e)}/>
          <div className="map-overlay" ref={overlay}>
            <svg width="100%" height="100%" aria-hidden="true">{shapes}</svg>
            {areaChips}
            {markers}
          </div>
          {tileMenu()}
          {mode==='edit'&&tool==='resize'&&<div className="map-resize-overlay">
            <svg width="100%" height="100%" aria-hidden="true"><polygon points={bounds.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#f0d6a5" strokeWidth="2" strokeDasharray="6 4"/></svg>
            {handles.map(h=>{const p=project(h.at),normal=Math.hypot(unit.x,unit.y);return <button key={h.edge} className="map-resize-handle" data-edge={h.edge} aria-label={`Resize ${h.edge} edge`} title={`Drag the ${h.edge} edge out to grow, in to crop. + / − adjusts it by a tile.`} style={{left:p.x+h.dx*unit.x/normal*24,top:p.y+h.dy*unit.y/normal*24}} onPointerDown={e=>resizeDown(e,h.edge)} onPointerMove={resizeMove} onPointerUp={resizeUp} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>{if(resizeDrag.current)finish(true)}} onKeyDown={e=>{if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();e.stopPropagation();if(!resizeDrag.current)applyResize(resizeCells(cells,h.edge,e.key==='-'?-1:1,eraseCh))}}}>{h.icon} {h.edge[0].toUpperCase()}</button>})}
            <div className="map-resize-guide"><strong>{shown.width} × {shown.height}</strong>{resizing?` · ${resizing.amount>=0?'+':''}${resizing.amount} ${resizing.edge} tiles · release to apply · Esc cancels`:` · Drag an edge to resize · new tiles are ${slotEntry(eraseCh).name} (the Erase material) · up to ${MAP_LIMIT.w} × ${MAP_LIMIT.h}`}</div>
          </div>}
          <div className="map-view-controls"><button aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(.15,z/1.2))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(3,z*1.2))}>+</button><button onClick={fit}>Fit <kbd>F</kbd></button></div>
          {laid&&'error' in laid&&<div className="map-place-note">{laid.error}</div>}
          {placeOf&&<div className="map-place-note">Showing {placeOf.place.title||placeOf.place.id} ({placeOf.path}) laid at ({placeOf.origin.x}, {placeOf.origin.y}): right-click a tile to add to it. <button onClick={()=>{setPlaceRegion(null);if(tab==='place')setTab('map');if(selection?.kind==='place')setSelection(null)}}>Hide it</button></div>}
        </div>
        <aside className="inspector map-inspector">
          <div className="inspector-tabs" role="tablist" aria-label="Inspector">{tabs.map(([id,label,count])=><button key={id} role="tab" aria-selected={tab===id} aria-label={count===undefined?label:`${label} (${count})`} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}{count!==undefined&&<span className={`count${id==='problems'&&count?' bad':''}`}>{count}</span>}</button>)}</div>
          <div className="inspector-body" role="tabpanel">{inspector()}</div>
        </aside>
      </div>
      <footer className="map-status"><span>{shown.width} × {shown.height} tiles · 5 ft a tile<MapHover store={hover}/></span><span>{mode==='edit'?`Paint: ${slotEntry(paintCh).name} / Erase: ${slotEntry(eraseCh).name} · `:''}{tool==='resize'&&mode==='edit'?'Drag the edge handles to resize':tool==='region'&&mode==='edit'?'Drag a rectangle for a new region':'Drag to '+(mode==='preview'||tool==='pan'?'pan':tool==='erase'?'erase':'paint')} · Right-click: what's here · Middle-drag: pan · Wheel: zoom · Tab: switch</span></footer>
      {previewError&&<div className="map-error" role="alert">{previewError}</div>}
      {toast&&<div className="toast" role="status">{toast}<button aria-label="Dismiss" onClick={()=>setToast('')}><X size={12}/></button></div>}
    </div>
    {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} returnFocus={confirmFocus.current} fallbackFocus={canvas.current??root.current} onCancel={()=>setConfirmation(null)} onConfirm={()=>{const run=confirmation.run;setConfirmation(null);run()}}/>}
    {dialog?.kind==='legend'&&<NewLegendEntryDialog doc={doc} onClose={()=>setDialog(null)} onAdd={(ch,entry)=>{try{if(commit(addLegendEntry(edits.current.current,ch,entry))){setPaintCh(ch);setSlot('paint');setDialog(null);select({kind:'legend',ch})}}catch(error){setToast((error as Error).message)}}}/>}
    {dialog?.kind==='unlegend'&&<RemoveLegendEntryDialog doc={doc} ch={dialog.ch} uses={counts.get(dialog.ch)??0} onClose={()=>setDialog(null)} onRemove={replacement=>{const ch=dialog.ch;try{if(commit(removeLegendEntry(edits.current.current,ch,replacement))){setDialog(null);setSelection(null);if(paintCh===ch)setPaintCh(replacement??VOID);if(eraseCh===ch)setEraseCh(replacement??VOID)}}catch(error){setToast((error as Error).message)}}}/>}
    {dialog?.kind==='region'&&<NewRegionDialog rect={dialog.rect} taken={takenRegions} onClose={()=>setDialog(null)} onAdd={region=>{try{if(commit(addRegion(edits.current.current,region))){setDialog(null);select({kind:'region',index:edits.current.current.regions.length-1})}}catch(error){setToast((error as Error).message)}}}/>}
    {dialog?.kind==='exit'&&<NewExitDialog at={dialog.at} maps={choices.maps} landing={map=>landingOn(otherMap(map),doc.id)} onClose={()=>setDialog(null)} onAdd={exit=>{if(commit(addExit(edits.current.current,exit))){setDialog(null);select({kind:'exit',index:edits.current.current.exits.length-1})}}}/>}
    {dialog?.kind==='person'&&<NewPersonDialog at={dialog.at} onClose={()=>setDialog(null)} onAdd={person=>{if(commit(addPerson(edits.current.current,person))){setDialog(null);select({kind:'person',index:(edits.current.current.people?.length??1)-1})}}}/>}
    {dialog?.kind==='thing'&&placeOf&&<NewThingDialog doc={placeOf.place} at={dialog.at} area={dialog.area} onClose={()=>setDialog(null)} onAdd={thing=>{editPlace(addThing(placeOf.place,thing));setDialog(null);select({kind:'place',part:{kind:'thing',id:thing.id}})}}/>}
    {dialog?.kind==='area'&&placeOf&&<NewAreaDialog doc={placeOf.place} rect={{x:dialog.at[0]-2,y:dialog.at[1]-2,w:10,h:10}} onClose={()=>setDialog(null)} onAdd={area=>{editPlace(addArea(placeOf.place,area));setDialog(null);select({kind:'place',part:{kind:'area',id:area.id}})}}/>}
    {dialog?.kind==='starts'&&placeOf&&<NewStartDialog doc={placeOf.place} at={dialog.at} area={dialog.area} cast={placeOf.cast} onClose={()=>setDialog(null)} onAdd={(id,where)=>{editPlace(addPlacePerson(placeOf.place,id,where));setDialog(null);select({kind:'place',part:{kind:'person',id}})}}/>}
  </div></EditSession.Provider>;
}

/** The rectangle between two tiles, either way round. */
const rectOf=(a:Tile2,b:Tile2)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x)+1,h:Math.abs(a.y-b.y)+1});

/** What to paint and erase with at first: the most used ground, and what's painted most after it (or the void). */
function pickDefault(doc:MapDocument,cells:Cells,which:'paint'|'erase'):string{
  const ranked=[...usage(cells).entries()].filter(([ch])=>ch in doc.legend).sort((a,b)=>b[1]-a[1]).map(([ch])=>ch);
  const unused=Object.keys(doc.legend).filter(ch=>!ranked.includes(ch));
  const all=[...ranked,...unused];
  if(which==='erase')return all[0]??VOID;
  return all.find(ch=>ch!==all[0])??all[0]??VOID;
}
