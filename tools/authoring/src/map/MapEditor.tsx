// The map editor: a .kmmap file (the scenario format's map, version 2). Under its title, a bar of views:
// Paint (its tiles painted in its legend's characters on an isometric view, its regions, exits and people
// on it, the scenario's start, a scene's place laid over the region that lays it, and an inspector for
// what's selected there: a tile, a region, an exit, someone, a legend entry, a part of the place), the
// game's own renderer as its Preview, and the map's own fields: the Map, its Legend, Regions, Exits and
// People (by the hour), and its Problems.
import React,{useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Flag,Redo2,Undo2,X} from 'lucide-react';
import type {FileHost} from '../campaign/host.ts';
import {useCampaignFiles,useEdits,useWritten} from '../campaign/edits.ts';
import type {FileChange} from '../campaign/edits.ts';
import {campaignProblems,keyOfPath,pathIn,withDraft} from '../campaign/files.ts';
import type {CampaignProblem} from '../campaign/files.ts';
import {EditSession} from '../scene/fields.tsx';
import type {Option} from '../scene/fields.tsx';
import {ConfirmDialog} from '../ConfirmDialog';
import {DocHeading,Inspector,ProblemsList,ViewArea,ViewBar,revealSoon,useFileView} from '../campaign/views.tsx';
import type {NewKind,ViewTab} from '../campaign/views.tsx';
import {MAP_LIMIT,MAP_MIN,TIMES,VOID,addExit,addLegendEntry,addPerson,addRegion,cellAt,cellsOf,entryName,fill,inside,mapShapeOf,movedPoint,newMap,regionIds,removeExits,removeLegendEntry,removePerson,removeRegion,renameLegendChar,resizeCells,resizeMap,sameCells,serializeMap,setExit,setLegendEntry,setPersonField,setRegionField,thingsAt,usage,withCells} from './model.ts';
import type {Cells,MapDocument,MapEdge,PlaceRegion,Resize,Tile2,TimeOfDay} from './model.ts';
import {MapPixi,mapTileAt} from './pixi.ts';
import {MapStroke} from './stroke.ts';
import {MapHover,MapHoverStore} from './hover.tsx';
import {compiled as compileMap,preview} from './preview.ts';
import {swatchOf} from './look.ts';
import {ExitInspector,LegendInspector,PersonInspector,RegionInspector,TileInspector} from './inspectors.tsx';
import type {RegionContext,TileAction} from './inspectors.tsx';
import {ExitsView,LegendView,MapView,PeopleView,RegionsView} from './views.tsx';
import type {MapAround,MapViewActions} from './views.tsx';
import {NewExitDialog,NewLegendEntryDialog,NewPersonDialog,NewRegionDialog,RemoveLegendEntryDialog} from './dialogs.tsx';
import {landingOn,serializeScenario,setScenarioField,withStart} from '../scenario/model.ts';
import type {ScenarioDocument} from '../scenario/model.ts';
import {addCast,serializeScene,setSceneField,skeletonScene} from '../scene/model.ts';
import {PlacePartInspector} from '../place/inspectors.tsx';
import type {PlacePart} from '../place/inspectors.tsx';
import {NewAreaDialog,NewStartDialog,NewThingDialog} from '../place/dialogs.tsx';
import {FEET_PER_TILE,addArea,addPerson as addPlacePerson,addThing,areaAt,feetMoved,feetOfTile,moveArea,movePerson,moveThing,newPlace,onPlace as onPlaceFloor,ontoPlace,placeShapeOf,removeFromPlace,serializePlace,tilesOf} from '../place/model.ts';
import type {Feet,PlaceDocument} from '../place/model.ts';
import {castUsesOf,thingUsesOf} from '../place/uses.ts';
import '../campaign/views.css';
import '../map.css';

type View='paint'|'preview'|'map'|'legend'|'regions'|'exits'|'people'|'problems';
const VIEW_IDS:View[]=['paint','preview','map','legend','regions','exits','people','problems'];
type Tool='select'|'brush'|'rectangle'|'fill'|'erase'|'sample'|'pan'|'region'|'resize';
const TOOLS:Array<{id:Tool;name:string;key:string;icon:string}>=[
  {id:'select',name:'Select',key:'V',icon:'⬉'},{id:'brush',name:'Brush',key:'B',icon:'✎'},{id:'rectangle',name:'Rectangle',key:'R',icon:'▱'},{id:'fill',name:'Fill',key:'G',icon:'◈'},
  {id:'erase',name:'Erase',key:'E',icon:'⌫'},{id:'sample',name:'Eyedropper',key:'I',icon:'⌖'},{id:'pan',name:'Pan',key:'H',icon:'✥'},
  {id:'region',name:'Region',key:'N',icon:'⬚'},{id:'resize',name:'Resize',key:'S',icon:'⤢'},
];
type Selection={kind:'region'|'exit'|'person';index:number}|{kind:'legend';ch:string}|{kind:'start'}|{kind:'tile';at:Tile2}|{kind:'place';part:PlacePart}|null;
type DialogState={kind:'legend'}|{kind:'unlegend';ch:string}|{kind:'region';rect:{x:number;y:number;w:number;h:number}}|{kind:'exit';at:Tile2;fixed?:boolean}|{kind:'person';at:Tile2;fixed?:boolean}
  |{kind:'thing';at:Feet;area?:string}|{kind:'area';at:Feet}|{kind:'starts';at:Feet;area?:string}|null;
type Confirmation={title:string;description:string;confirmLabel:string;run:()=>void};
/** The place shown on the map: the region that lays it, and the place (its file, its text as this editor knows it, its document and its scene's cast); or why it can't be shown. */
type Laid={region:PlaceRegion;error:string}|{region:PlaceRegion;origin:Tile2;path:string;text:string;place:PlaceDocument;cast:Array<{id:string;name:string}>;scene:string};
const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');
const THING_GLYPHS:Record<string,string>={feature:'◆',object:'■',item:'•',creature:'¥',person:'☺'};
/** Where each of a map's problems is: the view that has its field. */
const FIELD_VIEWS:Record<string,View>={id:'map',title:'map',description:'map',grid:'map'};

/** The editor for a map file. The host saves what it's handed; the editor's undo lasts while the file is open. */
export function MapApp({document:initial,host}:{document:MapDocument;host:FileHost<MapDocument>}){
  const [toast,setToast]=useState('');
  const campaign=useCampaignFiles(host,setToast);
  // What this editor has written to other files lately (a place, the scenario, a scene), until the campaign is read again with it.
  const {writer,textOf,version:wrote}=useWritten(host,campaign);
  const edits=useEdits<MapDocument>({host:writer,initial,shape:mapShapeOf,serialize:serializeMap,onError:setToast});
  const doc=edits.doc;
  const ids=useId();
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),6000);return()=>clearTimeout(timer)},[toast]);
  // ---- The views, and the painter's state ----
  const [view,setView]=useFileView<View>(host.filePath,'paint',VIEW_IDS);
  const mode=view==='preview'?'preview':view==='paint'?'edit':null;
  const [tool,setTool]=useState<Tool>('brush'),[brush,setBrush]=useState(1);
  const cells=useMemo(()=>cellsOf(doc.grid),[doc.grid]);
  const counts=useMemo(()=>usage(cells),[cells]);
  const [paintCh,setPaintCh]=useState(()=>pickDefault(initial,cellsOf(initial.grid),'paint'));
  const [eraseCh,setEraseCh]=useState(()=>pickDefault(initial,cellsOf(initial.grid),'erase'));
  const [slot,setSlot]=useState<'paint'|'erase'>('paint'),[filter,setFilter]=useState('');
  const [selection,setSelection]=useState<Selection>(null);
  /** The item each list view has chosen: the legend's character, a region's, an exit's or a person's index. */
  const [chosen,setChosen]=useState<{legend?:string;regions?:number;exits?:number;people?:number}>({});
  const [placeRegion,setPlaceRegion]=useState<number|null>(null),[showRegions,setShowRegions]=useState(true),[names,setNames]=useState(true),[hour,setHour]=useState<TimeOfDay|''>('');
  const [menu,setMenu]=useState<{at:Tile2;x:number;y:number}|null>(null),[dialog,setDialog]=useState<DialogState>(null),[confirmation,setConfirmation]=useState<Confirmation|null>(null);
  const [camera,setCamera]=useState<Tile2>({x:cells.width/2-.5,y:cells.height/2-.5}),[zoom,setZoom]=useState(1),[size,setSize]=useState({w:900,h:650});
  const [grid,setGrid]=useState(true),[time,setTime]=useState<TimeOfDay>('afternoon'),[roofs,setRoofs]=useState(false),[previewError,setPreviewError]=useState('');
  const [resizing,setResizing]=useState<Resize|null>(null),[regionDraft,setRegionDraft]=useState<{a:Tile2;b:Tile2}|null>(null),[dragged,setDragged]=useState<{key:string;tile:Tile2}|null>(null);
  const root=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null),overlay=useRef<HTMLDivElement>(null),menuRef=useRef<HTMLDivElement>(null),confirmFocus=useRef<HTMLElement|null>(null);
  const pixi=useRef<MapPixi|null>(null),stroke=useRef<MapStroke|null>(null),pan=useRef<{x:number;y:number;camera:Tile2}|null>(null),liveCamera=useRef(camera);
  const resizeDrag=useRef<{base:Cells;edge:MapEdge;x:number;y:number;unit:Tile2;result:Resize}|null>(null);
  /** An edge cropped from the keyboard after asking: further presses on it, while it keeps the focus, crop without asking again (unless more than the ground would go). */
  const cropConsent=useRef<MapEdge|null>(null);
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
  const sceneFile=(id:string)=>campaign?.scenes.find(scene=>scene.key===id);
  /** A scene as this editor knows it: its file's text (what it wrote lately first) and its document. */
  const sceneNow=(id:string)=>{const file=sceneFile(id);if(!file?.doc)return undefined;const text=textOf(file.path,file.text)??file.text;let doc=file.doc;try{if(text!==file.text&&text)doc=JSON.parse(text)}catch{}return {path:file.path,text:text??'',doc}};
  const sceneTitle=(id:string)=>sceneFile(id)?.doc?.title??id;
  const choices={
    scenes:(scenarioDoc?.scenes??[]).map(id=>({value:id,label:`${sceneTitle(id)} (${id})`})) as Option[],
    maps:(scenarioDoc?.maps??[]).map(id=>({value:id,label:`${campaign?.maps.find(map=>map.key===id)?.doc?.title??id} (${id})`})) as Option[],
    places:(scenarioDoc?.places??[]).map(id=>({value:id,label:`${campaign?.places.find(place=>place.key===id)?.doc?.title??id} (${id})`})) as Option[],
  };
  const otherMap=(id:string)=>id===doc.id?doc:campaign?.maps.find(map=>map.key===id)?.doc;

  // The place laid at the region shown: the region's scene's place, at its worldOrigin.
  const laid=useMemo<Laid|undefined>(()=>{
    if(placeRegion===null)return undefined;
    const region=doc.regions[placeRegion];
    if(!region?.sceneId||!region.worldOrigin)return undefined;
    const scene=sceneNow(region.sceneId);
    const placeKey=scene?.doc.place;
    const file=placeKey?campaign?.places.find(p=>p.key===placeKey):undefined;
    if(!file?.doc)return {region,error:placeKey?`${region.sceneId}'s place ${placeKey} isn't one of the scenario's places, or doesn't open`:`${region.sceneId} has no place: choose or make one in the region's inspector`};
    const text=textOf(file.path,file.text)??file.text??'';
    let place:PlaceDocument;
    try{place=JSON.parse(text)}catch{place=file.doc}
    const cast=(scene?.doc.cast??[]).map(member=>({id:member.id,name:member.name||member.id}));
    return {region,origin:region.worldOrigin,path:file.path,text,place,cast,scene:region.sceneId};
  },[placeRegion,doc.regions,campaign,wrote]);
  const placeOf=laid&&!('error' in laid)?laid:undefined;
  // A selected region that lays its scene's place shows it, as soon as it does (its scene or its origin set while it's selected too).
  const selectedRegion=selection?.kind==='region'?doc.regions[selection.index]:undefined;
  const laysPlace=!!selectedRegion?.sceneId&&!!selectedRegion.worldOrigin;
  useEffect(()=>{if(selection?.kind==='region'&&laysPlace)setPlaceRegion(selection.index)},[selection,laysPlace,selectedRegion?.sceneId]);

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
  const edit=(next:MapDocument)=>{edits.commit(next,true)};
  const writeOther=(changes:FileChange[],own?:MapDocument,coalesce=false)=>edits.write(changes,own,coalesce);
  /** The place laid on the map edited (its own file): a field typed in is one step of undo, as in this file. */
  const editPlace=(next:PlaceDocument,coalesce=false)=>{
    if(!placeOf)return;
    const shape=placeShapeOf(next);
    if(shape.length){setToast(`Not saved: the game couldn't load the place like that (${shape[0]}).`);return}
    const after=serializePlace(next);
    if(after!==placeOf.text)void writeOther([{path:placeOf.path,before:placeOf.text,after}],undefined,coalesce);
  };
  /** The scenario changed, as a write of its file (or nothing, when there's none to write). */
  const scenarioChange=(change:(scenario:ScenarioDocument)=>ScenarioDocument):FileChange|undefined=>{
    if(!campaign?.scenarioPath||!scenarioDoc||!scenarioText)return undefined;
    const after=serializeScenario(change(scenarioDoc));
    return after===scenarioText?undefined:{path:campaign.scenarioPath,before:scenarioText,after};
  };
  /** The story's start moved onto a tile of this map (and the map listed, if it's the campaign's and isn't yet). */
  const startHere=(at:Tile2)=>{
    if(!campaign?.scenarioPath||!scenarioDoc||!scenarioText){setToast('There\'s no scenario to start in: open the campaign folder as the vault.');return}
    if(!listed&&!atCampaignPath){setToast(`The story can only start on one of the campaign's maps (maps/${doc.id}.kmmap); this file is ${host.filePath}.`);return}
    const change=scenarioChange(scenario=>{const next=withStart(scenario,doc.id,at);return listed?next:{...next,maps:[...next.maps,doc.id]}});
    if(change)void writeOther([change]);
  };
  /**
   * A new file of the campaign (a scene, a map, a place) made from its skeleton where it's picked: then,
   * as one step of undo, listed in the scenario, this map changed by `own`, and `others` written (a
   * scene's place). The file stays when the step is undone.
   */
  const makeFile=(kind:NewKind,title:string,id:string,own?:(map:MapDocument)=>MapDocument,others?:()=>Promise<FileChange[]>)=>{
    if(!campaign?.scenarioPath||!scenarioDoc){setToast('There\'s no scenario to list it in: open the campaign folder as the vault.');return}
    const list=kind==='scene'?'scenes':kind==='map'?'maps':'places';
    const path=kind==='scene'?pathIn.scene(campaign.root,id):kind==='map'?pathIn.map(campaign.root,id):pathIn.place(campaign.root,id);
    const text=kind==='scene'?serializeScene(skeletonScene(title,id)):kind==='map'?serializeMap(newMap(title,id)):serializePlace(newPlace(title,id));
    void host.create(path,text).then(async()=>{
      const listing=scenarioChange(scenario=>scenario[list].includes(id)?scenario:setScenarioField(scenario,list,[...scenario[list],id]));
      const changes=[...(listing?[listing]:[]),...(await others?.()??[])];
      void writeOther(changes,own?own(edits.current.current):undefined);
      setToast(`Made ${path}, and listed it in the scenario. Undo takes back what it changed; the file stays.`);
    }).catch(error=>setToast(String(error instanceof Error?error.message:error)));
  };
  /**
   * A scene's place set, in the scene's file as it is when it's written (read then, an open editor's draft
   * first: a scene just made may not be in the campaign this editor last read).
   */
  const sceneChange=async(id:string,place:string|undefined):Promise<FileChange[]>=>{
    const path=pathIn.scene(campaign?.root??'',id);
    const text=textOf(path,await host.files.read(path));
    if(text===undefined)throw new Error(`${path} isn't there, so its place can't be set from here.`);
    let scene;
    try{scene=JSON.parse(text)}catch{throw new Error(`${path} can't be read: open it to set its place.`)}
    const after=serializeScene(setSceneField(scene,'place',place));
    return after===text?[]:[{path,before:text,after}];
  };
  /** A scene's cast with someone new in it (their card's fields empty, for the author), as a write of the scene's file as it is now. */
  const castChange=async(scene:string,name:string,id:string):Promise<FileChange>=>{
    const path=pathIn.scene(campaign?.root??'',scene);
    const text=textOf(path,await host.files.read(path));
    if(text===undefined)throw new Error(`${path} isn't there, so they can't be added to its cast.`);
    const added=addCast(JSON.parse(text),name,id);
    if(added.id!==id)throw new Error(`${id} is in ${scene}'s cast already.`);
    return {path,before:text,after:serializeScene(added.doc)};
  };
  const regionContext:RegionContext={
    scenes:choices.scenes,maps:choices.maps,places:choices.places,
    taken:{scenes:campaign?.present.scenes??[],maps:campaign?.present.maps??[],places:campaign?.present.places??[]},
    newScene:(index,title,id)=>makeFile('scene',title,id,map=>setRegionField(map,index,'sceneId',id)),
    placeOf:scene=>{
      const file=sceneNow(scene);
      if(!file)return {error:`Reading ${scene}…`,reading:true};
      const key=file.doc.place,place=key?campaign?.places.find(p=>p.key===key):undefined;
      if(!key)return {error:`${sceneTitle(scene)} has no place yet: choose one of the scenario's, or make one.`};
      if(!place?.doc)return {key,error:`Its place ${key} isn't one of the scenario's places, or doesn't open.`};
      return {key,path:place.path,title:place.doc.title||key,size:place.doc.size};
    },
    setPlace:(scene,place)=>void sceneChange(scene,place).then(changes=>{if(changes.length)void writeOther(changes)}).catch(error=>setToast(String(error instanceof Error?error.message:error))),
    newPlace:(scene,title,id)=>makeFile('place',title,id,undefined,()=>sceneChange(scene,id)),
    open:path=>open(path),
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
  const choose=(ch:string)=>{finish();if(slot==='paint')setPaintCh(ch);else setEraseCh(ch);if(['select','sample','pan','resize','region'].includes(tool))setTool(slot==='erase'?'erase':'brush')};
  const chooseTool=(next:Tool)=>{finish();setTool(next);if(next==='erase')setSlot('erase');else if(['brush','rectangle','fill'].includes(next))setSlot('paint')};
  const paintWith=(ch:string)=>{setPaintCh(ch);setSlot('paint');setTool('brush');setView('paint')};
  /** Something selected on the painter: shown in the inspector (a region that lays a scene's place shows the place on the map too). */
  const select=(next:Selection)=>{
    setSelection(next);setMenu(null);
    if(next?.kind==='region'){const region=edits.current.current.regions[next.index];if(region?.sceneId&&region.worldOrigin)setPlaceRegion(next.index)}
  };
  /** Something of the map shown on the painter: the Paint view, it selected, and the view moved to it. */
  const showOnMap=(next:Exclude<Selection,null>)=>{
    setView('paint');select(next);
    const at=next.kind==='region'?(()=>{const r=doc.regions[next.index]?.rect;return r?{x:r.x+r.w/2-.5,y:r.y+r.h/2-.5}:undefined})():next.kind==='exit'?doc.exits[next.index]?.at:next.kind==='person'?doc.people?.[next.index]?.at:next.kind==='start'?start:next.kind==='tile'?next.at:undefined;
    if(at)setCamera({x:at.x,y:at.y});
  };
  const ask=(next:Confirmation)=>{confirmFocus.current=(root.current?.ownerDocument.activeElement as HTMLElement|null)??null;setMenu(null);setConfirmation(next)};
  const open=(path:string)=>void host.open(path).catch(error=>setToast(String(error instanceof Error?error.message:error)));

  // Removing, each after asking.
  const removeRegionAt=(index:number)=>{const region=doc.regions[index];ask({title:`Delete region ${region.name||region.id}?`,description:`This takes the region off the map${region.sceneId?`, and with it where ${region.sceneId} is played`:''}. Its scene's place file stays as it is. You can undo this.`,confirmLabel:'Delete region',run:()=>{if(commit(removeRegion(edits.current.current,index))){setSelection(null);if(placeRegion!==null)setPlaceRegion(placeRegion===index?null:placeRegion>index?placeRegion-1:placeRegion)}}})};
  const removeExitAt=(index:number)=>{const exit=doc.exits[index];ask({title:`Delete the exit “${exit.label}”?`,description:`The way from (${exit.at.x}, ${exit.at.y}) to ${exit.to.map} goes. You can undo this.`,confirmLabel:'Delete exit',run:()=>{if(commit(removeExits(edits.current.current,[index])))setSelection(null)}})};
  const removePersonAt=(index:number)=>{const person=doc.people![index];ask({title:`Delete ${person.name}?`,description:`${person.name} won't be about on the map. You can undo this.`,confirmLabel:'Delete',run:()=>{if(commit(removePerson(edits.current.current,index)))setSelection(null)}})};
  const removePlacePart=(part:PlacePart)=>{if(!placeOf)return;ask({title:'Remove from the place?',description:`Remove ${part.id} from ${placeOf.place.title||placeOf.place.id}? You can undo this.`,confirmLabel:'Remove',run:()=>{try{editPlace(removeFromPlace(placeOf.place,part.id));setSelection(null)}catch(error){setToast(String((error as Error).message))}}})};
  const renameLegend=(from:string,to:string)=>{
    try{if(commit(renameLegendChar(edits.current.current,from,to))){if(paintCh===from)setPaintCh(to);if(eraseCh===from)setEraseCh(to);setSelection(old=>old?.kind==='legend'&&old.ch===from?{kind:'legend',ch:to}:old);setChosen(old=>old.legend===from?{...old,legend:to}:old)}}
    catch(error){setToast((error as Error).message)}
  };
  const takenRegions=[...regionIds(campaign?.maps??[],doc.id)];
  const regionIdProblem=(index:number,id:string)=>!/^[a-z0-9][a-z0-9-]*$/.test(id)?'An id is a slug: lower-case letters, digits and dashes.':takenRegions.includes(id)||doc.regions.some((region,i)=>i!==index&&region.id===id)?`There's a region ${id} already: a region's id is unique across the campaign's maps.`:undefined;
  const renameRegion=(index:number,to:string)=>{const problem=regionIdProblem(index,to);if(problem){setToast(problem);return}commit(setRegionField(edits.current.current,index,'id',to))};

  // ---- Resizing ----
  const applyResize=(result:Resize,fromKeyboard=false)=>{
    if(!result.amount)return;
    const before=edits.current.current;
    const {doc:resized,lost}=resizeMap(before,result);
    const run=()=>{
      if(fromKeyboard)cropConsent.current=result.edge;
      const {offset}=result,changes:FileChange[]=[];
      if(offset.x||offset.y){
        // What other files say of this map's tiles moves with them: the story's start, and the exits that land here.
        if(start){const change=scenarioChange(scenario=>withStart(scenario,doc.id,{x:start.x+offset.x,y:start.y+offset.y}));if(change)changes.push(change)}
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
    // A crop asks first, but a key pressed again on the same edge that took the ground alone doesn't ask again.
    const consented=fromKeyboard&&cropConsent.current===result.edge&&!lost.length;
    if((result.removed||lost.length)&&!consented)ask({title:'Crop the map?',description:`This removes ${result.removed} tiles from the ${result.edge} edge, leaving a ${result.cells.width} × ${result.cells.height} map.${lost.length?` Off the map with them: ${lost.join(', ')}.`:''} A region partly off it is cut to what's left.${fromKeyboard?' Pressing − again on this edge crops on without asking, until you leave it.':''} You can undo this.`,confirmLabel:'Crop map',run});
    else run();
  };
  /** The map resized to a width and a height: the east edge, then the south one, each as its own step. */
  const resizeTo=(width:number,height:number)=>{
    const now=cellsOf(edits.current.current.grid);
    const w=Math.max(MAP_MIN,Math.min(MAP_LIMIT.w,width)),h=Math.max(MAP_MIN,Math.min(MAP_LIMIT.h,height));
    const east=resizeCells(now,'east',w-now.width,eraseCh);
    const south=resizeCells(east.cells,'south',h-now.height,eraseCh);
    const both:Resize={cells:south.cells,offset:{x:0,y:0},edge:w!==now.width?'east':'south',amount:(w-now.width)||(h-now.height),removed:Math.max(0,now.width*now.height-w*h)};
    const {doc:resized,lost}=resizeMap(edits.current.current,both);
    const run=()=>commit(resized);
    if(both.removed||lost.length)ask({title:'Crop the map?',description:`This makes it ${w} × ${h}, removing ${both.removed} tiles from its east and south edges.${lost.length?` Off the map with them: ${lost.join(', ')}.`:''} A region partly off it is cut to what's left. You can undo this.`,confirmLabel:'Crop map',run});
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
  const painting=tool==='brush'||tool==='erase';
  useEffect(()=>{if(mode==='edit')pixi.current?.setHover(tool==='pan'||tool==='resize'?null:hover.point,painting?brush:1)},[tool,brush,mode,shown]);
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
  const setHover=(point:Tile2|null)=>{hover.update(point,stroke.current?.draft??shown,doc.legend);if(mode==='edit')pixi.current?.setHover(tool==='pan'||tool==='resize'?null:point,painting?brush:1)};
  const local=(e:React.PointerEvent<HTMLCanvasElement>)=>{const box=e.currentTarget.getBoundingClientRect();return {x:e.clientX-box.left,y:e.clientY-box.top}};
  const down=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(e.button!==0&&e.button!==1&&e.button!==2)return;e.preventDefault();e.currentTarget.focus();
    setMenu(null);if(e.button===2||mode==='edit'&&e.currentTarget.dataset.renderer!=='pixi')return;
    const pos=local(e),p=tileFrom(pos.x,pos.y);
    e.currentTarget.setPointerCapture(e.pointerId);
    if(mode==='preview'||tool==='pan'||tool==='resize'||e.button!==0){pan.current={x:e.clientX,y:e.clientY,camera:{...liveCamera.current}};setHover(null);return}
    const m=cells;if(!inside(m,p))return;
    if(tool==='select'){select({kind:'tile',at:p});return}
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
  const switchView=(next:View)=>{finish();setMenu(null);setHover(null);setView(next)};
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
    (doc.people??[]).forEach((person,index)=>{if(hour&&!person.times.includes(hour))return;const k=`person:${index}`,p=project(at(k,person.at));markers.push(<button key={k} className={`map-marker map-marker-person${selection?.kind==='person'&&selection.index===index?' chosen':''}`} style={{left:p.x,top:p.y,color:person.color??'#b8ad9c'}} title={`${person.name} (${person.times.join(', ')})`} aria-label={`Person ${person.name} at ${person.at.x}, ${person.at.y}`} {...markerKeys(k,person.at,tile=>void commit(setPersonField(edits.current.current,index,'at',movedPoint(person.at,tile))),()=>select({kind:'person',index}))}>{person.glyph}</button>)});
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
        if(names)markers.push(<span key={`${k}:name`} className="map-marker-name" style={{left:p.x,top:p.y}} aria-hidden="true">{thing.name||thing.id}</span>);
      }
      for(const [id,person] of Object.entries(place.people)){
        const look=id==='player'?{glyph:'@',fg:'#f0e6c8'}:campaign?.looks[id]??{};
        const k=`starts:${id}`,feet=person.at??[place.areas.find(a=>a.id===person.in)?.rect.x??0,place.areas.find(a=>a.id===person.in)?.rect.y??0] as Feet;
        const tile={x:origin.x+Math.floor(feet[0]/FEET_PER_TILE),y:origin.y+Math.floor(feet[1]/FEET_PER_TILE)};
        const spot=dragged?.key===k?dragged.tile:{x:origin.x-.5+feet[0]/FEET_PER_TILE,y:origin.y-.5+feet[1]/FEET_PER_TILE};
        const p=project(spot),chosen=selection?.kind==='place'&&selection.part.id===id;
        markers.push(<button key={k} className={`map-marker map-marker-cast${chosen?' chosen':''}`} style={{left:p.x,top:p.y,color:look.fg??'#e8dcc0'}} title={`${id} starts here${person.note?`: ${person.note}`:''}`} aria-label={`${id} starts here`} data-starts={id} {...markerKeys(k,tile,target=>editPlace(movePerson(place,id,person.at?feetMoved(origin,person.at,target):feetOfTile(origin,target))),()=>select({kind:'place',part:{kind:'person',id}}))}>{look.glyph??id.charAt(0).toUpperCase()}</button>);
        if(names)markers.push(<span key={`${k}:name`} className="map-marker-name cast" style={{left:p.x,top:p.y}} aria-hidden="true">{placeOf.cast.find(member=>member.id===id)?.name??(id==='player'?'the player':id)}</span>);
      }
    }
  }
  const diamond=(x:number,y:number,w:number,h:number)=>[project({x:x-.5,y:y-.5}),project({x:x+w-.5,y:y-.5}),project({x:x+w-.5,y:y+h-.5}),project({x:x-.5,y:y+h-.5})].map(p=>`${p.x},${p.y}`).join(' ');
  const shapes:React.ReactNode[]=[];
  if(mode==='edit'&&tool!=='resize'){
    doc.regions.forEach((region,index)=>{const r=region.rect,chosen=selection?.kind==='region'&&selection.index===index;if(!chosen&&!showRegions)return;shapes.push(<polygon key={`region:${index}`} className={`map-region${chosen?' chosen':''}${region.sceneId?' plays':''}`} points={diamond(r.x,r.y,r.w,r.h)} data-region={region.id}/>)});
    if(selection?.kind==='tile')shapes.push(<polygon key="tile" className="map-tile-chosen" points={diamond(selection.at.x,selection.at.y,1,1)}/>);
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

  // ---- What can be done at a tile: the tile's menu (a right-click) and the tile's inspector (Select, V) alike ----
  const tileOptions=(tile:Tile2)=>{
    const place=placeOf?.place,origin=placeOf?.origin;
    // The tile's middle in the place's feet, when the tile is the place's (its part-covered last row and column brought onto its floor); off the place, nothing of it can be added.
    const feet=place&&origin&&onPlaceFloor(place,[(tile.x-origin.x)*FEET_PER_TILE,(tile.y-origin.y)*FEET_PER_TILE])?ontoPlace(place,feetOfTile(origin,tile)):undefined;
    const area=place&&feet?areaAt(place,feet):undefined;
    const parts=place&&origin?[...place.things.filter(t=>t.at&&origin.x+Math.floor(t.at[0]/FEET_PER_TILE)===tile.x&&origin.y+Math.floor(t.at[1]/FEET_PER_TILE)===tile.y).map(t=>({kind:'thing' as const,id:t.id,name:t.name})),...Object.entries(place.people).filter(([,p])=>p.at&&origin.x+Math.floor(p.at[0]/FEET_PER_TILE)===tile.x&&origin.y+Math.floor(p.at[1]/FEET_PER_TILE)===tile.y).map(([id])=>({kind:'person' as const,id,name:id}))]:[];
    const adds:TileAction[]=[
      {label:'Add region here…',run:()=>setDialog({kind:'region',rect:{x:tile.x,y:tile.y,w:1,h:1}})},
      {label:'Add exit here…',run:()=>setDialog({kind:'exit',at:tile,fixed:true})},
      {label:'Add person here…',run:()=>setDialog({kind:'person',at:tile,fixed:true})},
      {label:'Start the story here',run:()=>startHere(tile)},
      ...(place&&feet?[
        {label:`Add a thing of ${place.title||place.id} here…`,run:()=>setDialog({kind:'thing',at:feet,area:area?.id})},
        {label:`Add an area of ${place.title||place.id} here…`,run:()=>setDialog({kind:'area',at:feet})},
        {label:'Start someone of the scene here…',run:()=>setDialog({kind:'starts',at:feet,area:area?.id})},
      ]:[]),
    ];
    return {parts,adds};
  };
  const tileMenu=()=>{
    if(!menu)return null;
    const here=thingsAt(doc,menu.at),entry=doc.legend[cellAt(cells,menu.at)];
    const {parts,adds}=tileOptions(menu.at);
    const item=(label:string,run:()=>void,danger=false)=><button key={label} role="menuitem" className={danger?'danger':''} onClick={()=>{setMenu(null);run()}}>{label}</button>;
    return <div className="map-context-menu" ref={menuRef} role="menu" aria-label={`Tile ${menu.at.x}, ${menu.at.y}`} style={{left:menu.x,top:menu.y}} onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll('button')),i=buttons.indexOf(e.currentTarget.ownerDocument.activeElement as HTMLButtonElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus()}}}>
      <small>Tile {menu.at.x}, {menu.at.y} · {entryName(entry)}{cellAt(cells,menu.at)!==VOID?` “${cellAt(cells,menu.at)}”`:''}</small>
      {here.regions.map(({region,index})=><React.Fragment key={`r${index}`}>{item(`Edit region ${region.name||region.id}…`,()=>select({kind:'region',index}))}{item(`Delete region ${region.name||region.id}…`,()=>removeRegionAt(index),true)}</React.Fragment>)}
      {here.exits.map(({exit,index})=><React.Fragment key={`e${index}`}>{item(`Edit exit ${exit.label}…`,()=>select({kind:'exit',index}))}{item(`Delete exit ${exit.label}…`,()=>removeExitAt(index),true)}</React.Fragment>)}
      {here.people.map(({person,index})=><React.Fragment key={`p${index}`}>{item(`Edit ${person.name}…`,()=>select({kind:'person',index}))}{item(`Delete ${person.name}…`,()=>removePersonAt(index),true)}</React.Fragment>)}
      {parts.map(part=><React.Fragment key={`t${part.id}`}>{item(`Edit ${part.name}…`,()=>select({kind:'place',part}))}{item(`Remove ${part.name} from the place…`,()=>removePlacePart(part),true)}</React.Fragment>)}
      {adds.map(add=>item(add.label,add.run))}
    </div>;
  };

  // ---- The inspector: what's selected on the painter, and nothing else ----
  const regionPlaceNote=(index:number)=>{
    const region=doc.regions[index];
    if(!region?.sceneId||region.worldOrigin)return undefined;
    const layer=campaign?.maps.flatMap(map=>(map.key===doc.id?doc:map.doc)?.regions.filter(r=>r.sceneId===region.sceneId&&r.worldOrigin).map(r=>`${r.name||r.id} on ${map.doc?.title??map.key}`)??[]);
    return layer?.length?`It opens ${region.sceneId}, whose place is laid by ${layer.join(', ')}.`:`It opens ${region.sceneId}, but no region lays its place.`;
  };
  const exitMapFor=(index:number,title:string,id:string)=>{const at=landingOn(newMap(title,id));makeFile('map',title,id,map=>setExit(map,index,{...map.exits[index],to:{map:id,at}}))};
  const inspectorWhat=():React.ReactNode=>{
    const s=selection;
    if(!s)return 'Nothing selected';
    const kinds={region:'Region',exit:'Exit',person:'Someone about',legend:'Legend entry',start:'The story\'s start',tile:'Tile',place:'The place'};
    return <><span className={`kind-dot ${s.kind==='place'?'place':s.kind}`}/>{kinds[s.kind]}</>;
  };
  const inspectorBody=()=>{
    const s=selection;
    if(!s)return <p className="info-box">Choose <b>Select</b> (V) and click a tile to see what's there and add a region, an exit or someone to it; or right-click any tile. Click a marker to edit it, or ✎ beside a legend entry. A region that lays a scene's place shows the place on the map. The map's own fields, its legend, regions, exits and people are views of their own, in the bar above.</p>;
    if(s.kind==='region')return <RegionInspector key={`region:${s.index}`} doc={doc} index={s.index} context={regionContext} onChange={edit} onRemove={()=>removeRegionAt(s.index)} shown={placeRegion===s.index} onShowPlace={doc.regions[s.index]?.sceneId&&doc.regions[s.index]?.worldOrigin?()=>setPlaceRegion(placeRegion===s.index?null:s.index):undefined} placeNote={regionPlaceNote(s.index)} onRename={to=>renameRegion(s.index,to)}/>;
    if(s.kind==='exit')return <ExitInspector key={`exit:${s.index}`} doc={doc} index={s.index} maps={choices.maps} taken={campaign?.present.maps??[]} onChange={edit} onRemove={()=>removeExitAt(s.index)} onOpen={map=>open(pathIn.map(campaign?.root??'',map))} onNewMap={exitMapFor}/>;
    if(s.kind==='person')return <PersonInspector key={`person:${s.index}`} doc={doc} index={s.index} onChange={edit} onRemove={()=>removePersonAt(s.index)}/>;
    if(s.kind==='legend'){const entry=doc.legend[s.ch];return entry?<LegendInspector key={`legend:${s.ch}`} doc={doc} ch={s.ch} entry={entry} uses={counts.get(s.ch)??0} onChange={next=>edit(setLegendEntry(edits.current.current,s.ch,next))} onRename={to=>renameLegend(s.ch,to)} onRemove={()=>setDialog({kind:'unlegend',ch:s.ch})} onPaint={()=>paintWith(s.ch)}/>:<p className="muted">That entry isn't in the legend any more.</p>}
    if(s.kind==='start')return <div className="start-inspector"><p className="inspector-kind"><Flag size={13}/>The story's start{start&&<code>{start.x}, {start.y}</code>}</p><p className="muted">{start?`Day ${scenarioDoc?.start.day}, ${scenarioDoc?.start.time}: the player starts walking here, on ${doc.title}. Drag the flag to move it; the scenario's start moves with it.`:'The story doesn\'t start on this map.'}</p>{campaign?.scenarioPath&&<button type="button" className="text-button" onClick={()=>open(campaign.scenarioPath!)}>Open the scenario</button>}</div>;
    if(s.kind==='tile'){const {parts,adds}=tileOptions(s.at);return <TileInspector key={`tile:${s.at.x},${s.at.y}`} doc={doc} cells={cells} at={s.at} onSelect={select} onPaint={paintWith} onEditEntry={ch=>select({kind:'legend',ch})} actions={adds} start={!!start&&start.x===s.at.x&&start.y===s.at.y} placeParts={parts.map(part=>({label:part.name,detail:`${part.kind==='thing'?'a thing':'starts here'} of ${placeOf?.place.title??'the place'}`,run:()=>select({kind:'place',part})}))}/>}
    if(s.kind==='place'&&placeOf)return <PlacePartInspector key={`${s.part.kind}:${s.part.id}`} part={s.part} doc={placeOf.place} onChange={next=>editPlace(next,true)} onSelect={part=>part?select({kind:'place',part}):setSelection(null)} confirm={(title,description,label,run)=>ask({title,description,confirmLabel:label,run})} cast={placeOf.cast}
      uses={part=>(part.kind==='thing'?thingUsesOf(placeOf.place,part.id,campaign?.scenes??[]):part.kind==='person'?castUsesOf(placeOf.place,part.id,campaign?.scenes??[]):[]).map((use,i)=>({key:`${use.scene}:${i}`,label:`${use.sceneTitle}: ${use.where}`,detail:use.scene,onOpen:()=>open(use.path)}))}
      onRenamed={(part,to)=>select({kind:'place',part:{...part,id:to}})}/>;
    return <p className="muted">Nothing to show: the place isn't shown on the map any more.</p>;
  };

  // ---- Going to a problem: its view and its item ----
  const go=(problem:CampaignProblem)=>{
    const where=problem.at;
    if(where.kind==='map'&&where.map===doc.id){
      if(where.region!==undefined){const index=doc.regions.findIndex(r=>r.id===where.region);if(index>=0){setChosen(old=>({...old,regions:index}));setView('regions');return}}
      if(where.exit!==undefined){setChosen(old=>({...old,exits:where.exit}));setView('exits');return}
      if(where.person!==undefined){setChosen(old=>({...old,people:where.person}));setHour('');setView('people');return}
      if(where.legend!==undefined){setChosen(old=>({...old,legend:where.legend}));setView('legend');return}
      setView(FIELD_VIEWS[where.field??'']??'map');revealSoon(root.current,where.field??'title');return;
    }
    if(where.kind==='place'&&placeOf){const id=where.thing??where.area??where.person;if(id){showOnMap({kind:'place',part:{kind:where.thing?'thing':where.area?'area':'person',id}});return}}
    open(problem.path);
  };

  // ---- Keys: scoped to this editor, never while typing ----
  const onKeyDown=(e:React.KeyboardEvent)=>{
    if(confirmation||dialog||editable(e.target))return;
    if(menu){if(e.key==='Escape'){setMenu(null);canvas.current?.focus();e.preventDefault()}return}
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();if(e.key.toLowerCase()==='y'||e.shiftKey)void edits.redo();else void edits.undo();return}
    if(view!=='paint'&&view!=='preview')return;
    if(e.key==='Escape'){finish(true);setRegionDraft(null);e.preventDefault();return}
    if(resizeDrag.current||markerDrag.current){e.preventDefault();return}
    if(e.target instanceof Element&&e.target.closest('.inspector,.map-palette'))return;
    if(e.key==='Tab'&&(e.target===canvas.current||e.target===root.current)){e.preventDefault();e.stopPropagation();switchView(view==='paint'?'preview':'paint');return}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='Delete'||e.key==='Backspace'){if(selection){deleteSelection();e.preventDefault()}return}
    const key=e.key.toUpperCase(),chosenTool=TOOLS.find(t=>t.key===key);
    if(chosenTool&&view==='paint'){chooseTool(chosenTool.id);e.preventDefault()}
    else if(key==='X'&&view==='paint'){finish();setPaintCh(eraseCh);setEraseCh(paintCh);e.preventDefault()}
    else if(key==='F'){fit();e.preventDefault()}
    else if((key==='['||key===']')&&view==='paint'){setBrush(v=>Math.max(1,Math.min(5,v+(key===']'?1:-1))));e.preventDefault()}
  };

  // ---- The views of the map's own ----
  const viewActions:MapViewActions={
    edit,
    showOnMap:next=>showOnMap(next),
    removeRegion:removeRegionAt,removeExit:removeExitAt,removePerson:removePersonAt,
    removeLegend:ch=>setDialog({kind:'unlegend',ch}),
    setLegend:(ch,entry)=>edit(setLegendEntry(edits.current.current,ch,entry)),
    renameLegend,renameRegion,regionIdProblem,paintWith,
    add:kind=>{
      const middle={x:Math.floor(cells.width/2),y:Math.floor(cells.height/2)};
      if(kind==='legend')setDialog({kind:'legend'});
      else if(kind==='region')setDialog({kind:'region',rect:{x:middle.x,y:middle.y,w:3,h:3}});
      else if(kind==='exit')setDialog({kind:'exit',at:middle});
      else setDialog({kind:'person',at:middle});
    },
    resizeTo,startHere,open,
    openMap:map=>open(pathIn.map(campaign?.root??'',map)),
    newMapFor:exitMapFor,
  };
  const around:MapAround={
    listed,notes,middle:landingOn(doc),
    ...(start&&scenarioDoc?{start:{at:start,day:scenarioDoc.start.day,time:scenarioDoc.start.time}}:{}),
    ...(scenarioDoc?.start.map&&scenarioDoc.start.map!==doc.id?{startsElsewhere:campaign?.maps.find(map=>map.key===scenarioDoc.start.map)?.doc?.title??scenarioDoc.start.map}:{}),
    waysIn:(campaign?.maps??[]).filter(map=>map.key!==doc.id).flatMap(map=>(map.doc?.exits??[]).filter(exit=>exit.to.map===doc.id).map(exit=>({from:map.key,fromTitle:map.doc?.title??map.key,label:exit.label,at:exit.to.at,path:map.path}))),
    laid:doc.regions.filter(region=>region.sceneId&&region.worldOrigin).map(region=>{const scene=sceneNow(region.sceneId!),key=scene?.doc.place,file=key?campaign?.places.find(p=>p.key===key):undefined;return {region:region.id,name:region.name||region.id,scene:region.sceneId!,...(key?{place:key,placeTitle:file?.doc?.title??key,path:file?.path??`places/${key}.kmplace`}:{})}}),
  };
  const tabs:ViewTab<View>[]=[
    {id:'paint',label:'Paint'},{id:'preview',label:'Preview'},{id:'map',label:'Map'},
    {id:'legend',label:'Legend',count:Object.keys(doc.legend).length},{id:'regions',label:'Regions',count:doc.regions.length},
    {id:'exits',label:'Exits',count:doc.exits.length},{id:'people',label:'People',count:doc.people?.length??0},
    {id:'problems',label:'Problems',...(campaign&&listed?{count:problems.length,bad:true}:{})},
  ];

  // ---- The page ----
  const entries=Object.entries(doc.legend);
  const shownEntries=entries.filter(([ch,entry])=>!filter.trim()||`${ch} ${entryName(entry)} ${entry.terrain} ${entry.style??''}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const slotEntry=(ch:string)=>({name:ch===VOID?'Void':entryName(doc.legend[ch]),swatch:swatchOf(doc.legend[ch])});
  const bounds=[{x:-.5,y:-.5},{x:shown.width-.5,y:-.5},{x:shown.width-.5,y:shown.height-.5},{x:-.5,y:shown.height-.5}].map(project);
  const handles:Array<{edge:MapEdge;at:Tile2;dx:number;dy:number;icon:string}>=[
    {edge:'north',at:{x:(shown.width-1)/2,y:-.5},dx:-1,dy:-1,icon:'↖'},{edge:'east',at:{x:shown.width-.5,y:(shown.height-1)/2},dx:1,dy:-1,icon:'↗'},
    {edge:'south',at:{x:(shown.width-1)/2,y:shown.height-.5},dx:1,dy:1,icon:'↘'},{edge:'west',at:{x:-.5,y:(shown.height-1)/2},dx:-1,dy:1,icon:'↙'},
  ];
  const stageElement=<div className="map-stage" ref={stage}>
    <canvas key={mode??'none'} ref={canvas} tabIndex={0} aria-label={mode==='edit'?'Isometric map painter':'Isometric game preview'} data-mode={mode??''} data-tool={tool} data-camera-x={camera.x} data-camera-y={camera.y} data-zoom={zoom} data-width={shown.width} data-height={shown.height} data-view-width={size.w} data-view-height={size.h}
      onPointerDown={down} onPointerMove={move} onPointerUp={e=>{finish();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish()} onPointerLeave={()=>{if(!stroke.current)setHover(null)}} onContextMenu={e=>openMenu(e)}/>
    <div className="map-overlay" ref={overlay}>
      <svg width="100%" height="100%" aria-hidden="true">{shapes}</svg>
      {areaChips}
      {markers}
    </div>
    {tileMenu()}
    {mode==='edit'&&tool==='resize'&&<div className="map-resize-overlay">
      <svg width="100%" height="100%" aria-hidden="true"><polygon points={bounds.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#f0d6a5" strokeWidth="2" strokeDasharray="6 4"/></svg>
      {handles.map(h=>{const p=project(h.at),normal=Math.hypot(unit.x,unit.y);return <button key={h.edge} className="map-resize-handle" data-edge={h.edge} aria-label={`Resize ${h.edge} edge`} title={`Drag the ${h.edge} edge out to grow, in to crop. + / − adjusts it by a tile.`} style={{left:p.x+h.dx*unit.x/normal*24,top:p.y+h.dy*unit.y/normal*24}} onPointerDown={e=>resizeDown(e,h.edge)} onPointerMove={resizeMove} onPointerUp={resizeUp} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>{if(resizeDrag.current)finish(true)}} onBlur={()=>{if(cropConsent.current===h.edge)cropConsent.current=null}} onKeyDown={e=>{if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();e.stopPropagation();if(!resizeDrag.current)applyResize(resizeCells(cells,h.edge,e.key==='-'?-1:1,eraseCh),true)}}}>{h.icon} {h.edge[0].toUpperCase()}</button>})}
      <div className="map-resize-guide"><strong>{shown.width} × {shown.height}</strong>{resizing?` · ${resizing.amount>=0?'+':''}${resizing.amount} ${resizing.edge} tiles · release to apply · Esc cancels`:` · Drag an edge to resize · new tiles are ${slotEntry(eraseCh).name} (the Erase material) · up to ${MAP_LIMIT.w} × ${MAP_LIMIT.h}`}</div>
    </div>}
    <div className="map-view-controls"><button aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(.15,z/1.2))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(3,z*1.2))}>+</button><button onClick={fit}>Fit <kbd>F</kbd></button></div>
    {mode==='edit'&&laid&&'error' in laid&&<div className="map-place-note">{laid.error}</div>}
    {mode==='edit'&&placeOf&&<div className="map-place-note">Showing {placeOf.place.title||placeOf.place.id} ({placeOf.path}) laid at ({placeOf.origin.x}, {placeOf.origin.y}): right-click a tile, or select one (V), to add to it. <button onClick={()=>{setPlaceRegion(null);if(selection?.kind==='place')setSelection(null)}}>Hide it</button></div>}
  </div>;
  const palette=<aside className="map-palette" aria-label="Palette">
    <div className="map-paint-pair" role="group" aria-label="Paint and erase materials">
      {(['paint','erase'] as const).map(which=>{const ch=which==='paint'?paintCh:eraseCh,look=slotEntry(ch);return <button key={which} className="map-material-slot" aria-label={`Choose ${which} material`} aria-pressed={slot===which} title={`${which==='paint'?'Paint':'Erase'}: ${look.name}`} onClick={()=>{finish();setSlot(which);if(which==='paint'&&tool==='erase')setTool('brush')}}><span style={{background:look.swatch}}/><span><small>{which.toUpperCase()}</small><strong>{ch===VOID?'':`“${ch}” `}{look.name}</strong></span></button>})}
      <button className="map-swap-materials" aria-label="Swap paint and erase materials" title="Swap materials (X)" onClick={()=>{finish();setPaintCh(eraseCh);setEraseCh(paintCh)}}>⇄ <span>Swap</span> <kbd>X</kbd></button>
      <small className="map-palette-hint">Click a slot, then an entry below. Ctrl/Cmd-drag paints with Erase.</small>
    </div>
    <div className="map-legend-head"><div className="eyebrow">LEGEND · {entries.length}</div><button className="map-new-entry" aria-label="New entry" title="A new legend entry" onClick={()=>setDialog({kind:'legend'})}><span>+</span> <span className="map-new-entry-label">New entry</span></button></div>
    {entries.length>10&&<input className="map-legend-filter" aria-label="Filter the legend" placeholder="Filter…" value={filter} onChange={e=>setFilter(e.target.value)}/>}
    <div className="map-materials" role="list" aria-label="Legend">
      {shownEntries.map(([ch,entry])=><div key={ch} className="map-material" role="listitem">
        <button className="map-material-choose" aria-label={`${slot==='paint'?'Paint':'Erase'} “${ch}” ${entryName(entry)}`} title={entryName(entry)} aria-pressed={(slot==='paint'?paintCh:eraseCh)===ch} onClick={()=>choose(ch)}><span style={{background:swatchOf(entry)}}/><code>{ch}</code><span className="name">{entryName(entry)}</span><small>{counts.get(ch)??0}</small></button>
        <button className="map-material-edit" aria-label={`Edit legend entry “${ch}”`} title="Edit this entry" onClick={()=>select({kind:'legend',ch})}>✎</button>
      </div>)}
      <div className="map-material" role="listitem"><button className="map-material-choose" aria-label={`${slot==='paint'?'Paint':'Erase'} the void`} title="Void (no tile)" aria-pressed={(slot==='paint'?paintCh:eraseCh)===VOID} onClick={()=>choose(VOID)}><span style={{background:swatchOf(undefined)}}/><code>␣</code><span className="name">Void (no tile)</span><small>{counts.get(VOID)??0}</small></button></div>
    </div>
    <div className="map-palette-options">
      <label>Brush size <strong>{brush} × {brush}</strong><input aria-label="Brush size" type="range" min="1" max="5" value={brush} onChange={e=>setBrush(Number(e.target.value))}/></label>
      <label className="map-check"><input type="checkbox" checked={grid} onChange={e=>setGrid(e.target.checked)}/>Show tile edges</label>
      <label className="map-check"><input type="checkbox" checked={showRegions} onChange={e=>setShowRegions(e.target.checked)}/>Show regions</label>
      <label className="map-check"><input type="checkbox" checked={names} onChange={e=>setNames(e.target.checked)}/>Name the place's things</label>
      <label className="field-label" htmlFor={`${ids}-hour`}>People about</label>
      <select id={`${ids}-hour`} aria-label="People about at" value={hour} onChange={e=>setHour(e.target.value as TimeOfDay|'')}><option value="">At any hour</option>{TIMES.map(t=><option key={t} value={t}>In the {t.replace('-',' ')}</option>)}</select>
    </div>
  </aside>;
  const listView=(node:React.ReactNode)=><div className="view-scroll">{node}</div>;
  return <EditSession.Provider value={edits.sessionHandlers}><div className="km-workshop km-forms km-map" ref={root} tabIndex={-1} data-campaign={campaign?'read':'reading'} onPointerDown={e=>{if(menu&&!(e.target as HTMLElement).closest('.map-context-menu'))setMenu(null)}} onKeyDown={onKeyDown}>
    <div className="map-body" inert={!!confirmation||!!dialog||undefined}>
      <header className="topbar"><span className="file-path" title={host.filePath}>{host.filePath}</span><span className="save">{edits.busy?'Saving…':'Autosaves to this file'}</span></header>
      <DocHeading kind="map" id={doc.id} title={doc.title} problems={problems.length} checking={!campaign} onProblems={()=>switchView('problems')}/>
      <ViewBar ids={ids} label="Views of the map" views={tabs} view={view} onView={switchView} actions={<>
        <button type="button" aria-label="Undo map edit" title="Undo (Ctrl Z)" disabled={!edits.canUndo||edits.busy} onClick={()=>void edits.undo()}><Undo2 size={16}/></button>
        <button type="button" aria-label="Redo map edit" title="Redo (Ctrl Shift Z)" disabled={!edits.canRedo||edits.busy} onClick={()=>void edits.redo()}><Redo2 size={16}/></button>
      </>}/>
      <ViewArea ids={ids} view={view}>
        {view==='paint'&&<div className="paint-view">
          <div className="map-toolbar" role="toolbar" aria-label="Tools">{TOOLS.map(t=><button key={t.id} aria-label={t.name} title={`${t.name} (${t.key})`} aria-pressed={tool===t.id} onClick={()=>chooseTool(t.id)}><span>{t.icon}</span><span className="tool-name">{t.name}</span><kbd>{t.key}</kbd></button>)}</div>
          <div className="map-content">
            {palette}
            {stageElement}
            <Inspector what={inspectorWhat()} empty={!selection} onClose={()=>setSelection(null)} className="map-inspector">{inspectorBody()}</Inspector>
          </div>
        </div>}
        {view==='preview'&&<div className="paint-view">
          <div className="map-toolbar"><span className="map-hint">The game's own renderer: the map as it's walked, read-only. Tab on the map goes back to Paint.</span></div>
          <div className="map-content">
            <aside className="map-palette preview-options" aria-label="Preview">
              <label className="field-label" htmlFor="km-preview-time">Time of day</label>
              <select id="km-preview-time" aria-label="Time of day" value={time} onChange={e=>setTime(e.target.value as TimeOfDay)}>{TIMES.map(t=><option key={t} value={t}>{t.replace('-',' ')}</option>)}</select>
              <label className="map-check"><input type="checkbox" checked={roofs} onChange={e=>setRoofs(e.target.checked)}/>Lift roofs</label>
              <p>The game's isometric renderer, on this map as the game builds it: its legend's tiles and decor, and the people about at this hour.</p>
            </aside>
            {stageElement}
          </div>
        </div>}
        {view==='map'&&listView(<MapView doc={doc} actions={viewActions} size={{width:cells.width,height:cells.height}} around={around}/>)}
        {view==='legend'&&listView(<LegendView doc={doc} actions={viewActions} counts={counts} chosen={chosen.legend} onChoose={ch=>setChosen(old=>({...old,legend:ch}))}/>)}
        {view==='regions'&&listView(<RegionsView doc={doc} actions={viewActions} context={regionContext} chosen={chosen.regions} onChoose={index=>setChosen(old=>({...old,regions:index}))} placeNote={regionPlaceNote}/>)}
        {view==='exits'&&listView(<ExitsView doc={doc} actions={viewActions} maps={choices.maps} taken={campaign?.present.maps??[]} chosen={chosen.exits} onChoose={index=>setChosen(old=>({...old,exits:index}))}/>)}
        {view==='people'&&listView(<PeopleView doc={doc} actions={viewActions} chosen={chosen.people} onChoose={index=>setChosen(old=>({...old,people:index}))} hour={hour} onHour={setHour}/>)}
        {view==='problems'&&listView(<ProblemsList lede={<>The campaign check's rules for this map{placeOf?' and the place laid on it':''} (<code>npm run campaign -- check</code>), with the map as it is now. Each takes you to its region, exit, person or legend entry, or opens its file.</>} problems={problems} notes={notes} checking={!campaign} clear={`No problems: the campaign check finds nothing in this map${placeOf?' or the place laid on it':''}.`} onGo={go} where={problem=>problem.at.kind==='map'?[problem.file,problem.at.region&&`region ${problem.at.region}`,problem.at.exit!==undefined&&`exit ${problem.at.exit+1}`,problem.at.person!==undefined&&`person ${problem.at.person+1}`,problem.at.legend!==undefined&&`legend “${problem.at.legend}”`].filter(Boolean).join(' · '):problem.file}/>)}
      </ViewArea>
      <footer className="map-status"><span>{shown.width} × {shown.height} tiles · 5 ft a tile<MapHover store={hover}/></span><span>{mode==='edit'?`Paint: ${slotEntry(paintCh).name} / Erase: ${slotEntry(eraseCh).name} · ${tool==='resize'?'Drag the edge handles to resize':tool==='region'?'Drag a rectangle for a new region':tool==='select'?'Click a tile to see what\'s there':'Drag to '+(tool==='pan'?'pan':tool==='erase'?'erase':'paint')} · Right-click: what's here · Middle-drag: pan · Wheel: zoom · Tab: preview`:mode==='preview'?'Drag to pan · Wheel: zoom · Tab: paint':'Each field saves as you type'}</span></footer>
      {previewError&&mode&&<div className="map-error" role="alert">{previewError}</div>}
      {toast&&<div className="toast" role="status">{toast}<button aria-label="Dismiss" onClick={()=>setToast('')}><X size={12}/></button></div>}
    </div>
    {confirmation&&<ConfirmDialog title={confirmation.title} description={confirmation.description} confirmLabel={confirmation.confirmLabel} returnFocus={confirmFocus.current} fallbackFocus={canvas.current??root.current} onCancel={()=>setConfirmation(null)} onConfirm={()=>{const run=confirmation.run;setConfirmation(null);run()}}/>}
    {dialog?.kind==='legend'&&<NewLegendEntryDialog doc={doc} onClose={()=>setDialog(null)} onAdd={(ch,entry)=>{try{if(commit(addLegendEntry(edits.current.current,ch,entry))){setPaintCh(ch);setSlot('paint');setDialog(null);setChosen(old=>({...old,legend:ch}));if(view==='paint')select({kind:'legend',ch})}}catch(error){setToast((error as Error).message)}}}/>}
    {dialog?.kind==='unlegend'&&<RemoveLegendEntryDialog doc={doc} ch={dialog.ch} uses={counts.get(dialog.ch)??0} onClose={()=>setDialog(null)} onRemove={replacement=>{const ch=dialog.ch;try{if(commit(removeLegendEntry(edits.current.current,ch,replacement))){setDialog(null);setSelection(null);if(paintCh===ch)setPaintCh(replacement??VOID);if(eraseCh===ch)setEraseCh(replacement??VOID)}}catch(error){setToast((error as Error).message)}}}/>}
    {dialog?.kind==='region'&&<NewRegionDialog rect={dialog.rect} taken={[...takenRegions,...doc.regions.map(r=>r.id)]} onClose={()=>setDialog(null)} onAdd={region=>{try{if(commit(addRegion(edits.current.current,region))){setDialog(null);const index=edits.current.current.regions.length-1;setChosen(old=>({...old,regions:index}));if(view==='paint')select({kind:'region',index})}}catch(error){setToast((error as Error).message)}}}/>}
    {dialog?.kind==='exit'&&<NewExitDialog at={dialog.at} fixed={dialog.fixed} maps={choices.maps} landing={map=>landingOn(otherMap(map),doc.id)} onClose={()=>setDialog(null)} onAdd={exit=>{if(commit(addExit(edits.current.current,exit))){setDialog(null);const index=edits.current.current.exits.length-1;setChosen(old=>({...old,exits:index}));if(view==='paint')select({kind:'exit',index})}}}/>}
    {dialog?.kind==='person'&&<NewPersonDialog at={dialog.at} fixed={dialog.fixed} onClose={()=>setDialog(null)} onAdd={person=>{if(commit(addPerson(edits.current.current,person))){setDialog(null);const index=(edits.current.current.people?.length??1)-1;setChosen(old=>({...old,people:index}));if(view==='paint')select({kind:'person',index})}}}/>}
    {dialog?.kind==='thing'&&placeOf&&<NewThingDialog doc={placeOf.place} at={dialog.at} area={dialog.area} onClose={()=>setDialog(null)} onAdd={thing=>{editPlace(addThing(placeOf.place,thing));setDialog(null);select({kind:'place',part:{kind:'thing',id:thing.id}})}}/>}
    {dialog?.kind==='area'&&placeOf&&<NewAreaDialog doc={placeOf.place} rect={{x:dialog.at[0]-2,y:dialog.at[1]-2,w:10,h:10}} onClose={()=>setDialog(null)} onAdd={area=>{editPlace(addArea(placeOf.place,area));setDialog(null);select({kind:'place',part:{kind:'area',id:area.id}})}}/>}
    {dialog?.kind==='starts'&&placeOf&&<NewStartDialog doc={placeOf.place} at={dialog.at} area={dialog.area} cast={placeOf.cast} scenes={[{key:placeOf.scene,title:sceneTitle(placeOf.scene)}]} onClose={()=>setDialog(null)} onAdd={(id,where,created)=>{
      const started=()=>{setDialog(null);select({kind:'place',part:{kind:'person',id}})};
      if(!created){editPlace(addPlacePerson(placeOf.place,id,where));started();return}
      // Someone new of the scene's cast: their card in the scene's file and their start in the place's, one step.
      const layer=placeOf;
      void castChange(created.scene,created.name,id).then(change=>writeOther([change,{path:layer.path,before:layer.text,after:serializePlace(addPlacePerson(layer.place,id,where))}])).then(ok=>{if(ok)started()}).catch(error=>setToast(String(error instanceof Error?error.message:error)));
    }}/>}
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
