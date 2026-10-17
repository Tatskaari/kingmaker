import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {GraphDocument,Host} from './model';
import {serializeDocument,uid,removeNodes} from './model';
import {PALETTE,CLUTTER,blankMap,fill,gameMap,gameClutter,inside,resizeMap,sameMap,fillClutter,paintClutter} from './map-model';
import type {MapData,PaintId,Point,MapEdge,MapResize,ClutterId} from './map-model';
import {saveMapFeature,resizeMapDocument} from './map-features';
import {MapFeatureDialog,type FeatureEditor} from './MapFeatureDialog';
import {preview} from './map-preview.js';
import {ConfirmDialog} from './ConfirmDialog';
import {MapPixi,mapTileAt} from './map-pixi';
import {MapStroke} from './map-stroke';
import {MapHover,MapHoverStore} from './MapHover';
import './map.css';

type Mode='edit'|'preview';
type Tool='brush'|'rectangle'|'fill'|'erase'|'sample'|'pan'|'resize';
const TOOLS:Array<{id:Tool;name:string;key:string;icon:string}>=[{id:'brush',name:'Brush',key:'B',icon:'✎'},{id:'rectangle',name:'Rectangle',key:'R',icon:'▱'},{id:'fill',name:'Fill',key:'G',icon:'◈'},{id:'erase',name:'Erase',key:'E',icon:'⌫'},{id:'sample',name:'Eyedropper',key:'I',icon:'⌖'},{id:'pan',name:'Pan',key:'H',icon:'✥'},{id:'resize',name:'Resize',key:'S',icon:'⤢'}];
const textTarget=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');

export function MapEditor({document:initial,host}:{document:GraphDocument;host:Host}){
  const [doc,setDoc]=useState(initial),current=useRef(initial);
  const [mode,setMode]=useState<Mode>('edit'),[tool,setTool]=useState<Tool>('brush'),[material,setMaterial]=useState<PaintId>('cobbles'),[brush,setBrush]=useState(1);
  const [eraseMaterial,setEraseMaterial]=useState<PaintId>('grass'),[paletteSlot,setPaletteSlot]=useState<'paint'|'erase'>('paint');
  const [layer,setLayer]=useState<'terrain'|'clutter'>('terrain'),[clutterMaterial,setClutterMaterial]=useState<ClutterId>('lamp');
  const [menu,setMenu]=useState<{at:Point;x:number;y:number}|null>(null),[feature,setFeature]=useState<FeatureEditor|null>(null);
  const [deletion,setDeletion]=useState<{kind:'feature';id:string;title:string;type:string}|{kind:'clutter';at:Point;title:string}|null>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const [past,setPast]=useState<GraphDocument[]>([]),[future,setFuture]=useState<GraphDocument[]>([]),history=useRef<GraphDocument[]>([]),ahead=useRef<GraphDocument[]>([]);
  const stroke=useRef<MapStroke|null>(null);
  const hover=useMemo(()=>new MapHoverStore(),[]),[camera,setCamera]=useState<Point>({x:(initial.terrain?.width??32)/2-.5,y:(initial.terrain?.height??24)/2-.5});
  const [zoom,setZoom]=useState(1),[night,setNight]=useState(false),[roofs,setRoofs]=useState(false),[grid,setGrid]=useState(true);
  const [size,setSize]=useState({w:900,h:650}),[confirmation,setConfirmation]=useState<'resize'|null>(null),[error,setError]=useState(''),[previewError,setPreviewError]=useState('');
  const [resizing,setResizing]=useState<MapResize|null>(null),[pendingResize,setPendingResize]=useState<MapResize|null>(null);
  const resizeDrag=useRef<{base:MapData;edge:MapEdge;x:number;y:number;unit:Point;result:MapResize}|null>(null);
  const root=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null),confirmFocus=useRef<HTMLElement|null>(null);
  const pan=useRef<{x:number;y:number;camera:Point}|null>(null),liveCamera=useRef(camera),pixi=useRef<MapPixi|null>(null);
  const markers=useRef<HTMLDivElement>(null),resizeOverlay=useRef<HTMLDivElement>(null);
  const previewTile=useRef<(x:number,y:number)=>Point|undefined>(()=>undefined);
  const empty=useMemo(()=>blankMap(),[]),saved=doc.terrain??empty,shown=resizing?.map??saved;
  const compiled=useMemo(()=>mode==='preview'?gameMap(shown,doc.id,doc.title):null,[mode,shown,doc.id,doc.title]);
  const actors=useMemo(()=>mode==='preview'?gameClutter(shown,doc.id):[],[mode,shown,doc.id]);
  const features=useMemo(()=>doc.nodes.filter(n=>n.data.mapFeature&&n.data.mapAt),[doc.nodes]);
  const selected=PALETTE.find(p=>p.id===material)!;
  const eraseSelected=PALETTE.find(p=>p.id===eraseMaterial)!;
  const unit=mode==='preview'?{x:12*zoom,y:12*zoom}:{x:18*zoom,y:9*zoom};
  const viewCamera={x:camera.x+(resizing?.offset.x??0),y:camera.y+(resizing?.offset.y??0)};
  const project=(p:Point)=>({x:size.w/2+(p.x-viewCamera.x+p.y-viewCamera.y)*unit.x,y:size.h*.56+(p.y-viewCamera.y-p.x+viewCamera.x)*unit.y});
  const tileFrom=(x:number,y:number)=>{if(mode==='edit')return mapTileAt({width:size.w,height:size.h,camera:liveCamera.current,zoom},x,y);const a=(x-size.w/2)/unit.x,b=(y-size.h*.56)/unit.y;return {x:Math.floor(liveCamera.current.x+(a-b)/2+.5),y:Math.floor(liveCamera.current.y+(a+b)/2+.5)}};
  const publish=(next:GraphDocument)=>{try{host.change(next);current.current=next;setDoc(next);setError('');return true}catch(e){setError(String(e));return false}};
  const commit=(next:GraphDocument)=>{if(serializeDocument(next)===serializeDocument(current.current))return;const before=current.current;if(publish(next)){history.current=[...history.current.slice(-99),before];ahead.current=[];setPast(history.current);setFuture([])}};
  const setHover=(point:Point|null)=>{hover.update(point,stroke.current?.draft??shown);if(mode==='edit')pixi.current?.setHover(tool==='pan'||tool==='resize'?null:point,tool==='brush'||tool==='erase'?brush:1)};
  const finish=(cancel=false)=>{
    const s=stroke.current;stroke.current=null;
    if(pan.current)setCamera({...liveCamera.current});pan.current=null;resizeDrag.current=null;setResizing(null);
    if(s){if(!cancel&&s.changed)commit({...current.current,terrain:s.draft});const accepted=current.current.terrain===s.draft;if(!accepted)pixi.current?.patch(s.base,s.touched);hover.update(hover.point,accepted?s.draft:s.base)}
  };
  const chooseTool=(next:Tool)=>{finish();setTool(next);if(next==='erase')setPaletteSlot('erase');else if(['brush','rectangle','fill'].includes(next))setPaletteSlot('paint')};
  const swapMaterials=()=>{finish();setMaterial(eraseMaterial);setEraseMaterial(material)};
  const chooseMaterial=(id:PaintId)=>{finish();setLayer('terrain');if(paletteSlot==='paint')setMaterial(id);else setEraseMaterial(id);if(['sample','pan','resize'].includes(tool))setTool('brush')};
  const applyResize=(result:MapResize)=>{if(!result.amount)return;const before=current.current;commit(resizeMapDocument(before,result));if(current.current!==before)setCamera(c=>({x:c.x+result.offset.x,y:c.y+result.offset.y}));setHover(null)};
  const proposeResize=(result:MapResize,trigger:HTMLElement)=>{if(!result.amount)return;if(result.removed){confirmFocus.current=trigger;setPendingResize(result);setConfirmation('resize')}else applyResize(result)};
  const resizeDown=(e:React.PointerEvent<HTMLButtonElement>,edge:MapEdge)=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();finish();setHover(null);e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);const base=current.current.terrain??empty,result=resizeMap(base,edge,0);resizeDrag.current={base,edge,x:e.clientX,y:e.clientY,unit:{...unit},result};setResizing(result)};
  const resizeMove=(e:React.PointerEvent<HTMLButtonElement>)=>{const r=resizeDrag.current;if(!r)return;const a=(e.clientX-r.x)/r.unit.x,b=(e.clientY-r.y)/r.unit.y,dx=(a-b)/2,dy=(a+b)/2;const length=r.edge==='east'||r.edge==='west'?r.base.width:r.base.height,amount=Math.max(4-length,Math.min(64-length,Math.round(r.edge==='east'?dx:r.edge==='west'?-dx:r.edge==='south'?dy:-dy)));if(amount===r.result.amount)return;r.result=resizeMap(r.base,r.edge,amount);setResizing(r.result)};
  const resizeUp=(e:React.PointerEvent<HTMLButtonElement>)=>{const r=resizeDrag.current;resizeDrag.current=null;setResizing(null);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(r)proposeResize(r.result,e.currentTarget)};
  const undo=()=>{finish();const prev=history.current.at(-1);if(!prev)return;const now=current.current;if(publish(prev)){history.current=history.current.slice(0,-1);ahead.current=[now,...ahead.current];setPast(history.current);setFuture(ahead.current)}};
  const redo=()=>{finish();const next=ahead.current[0];if(!next)return;const now=current.current;if(publish(next)){history.current=[...history.current,now];ahead.current=ahead.current.slice(1);setPast(history.current);setFuture(ahead.current)}};
  const switchMode=(next:Mode)=>{finish();setMenu(null);setHover(null);setMode(next)};
  const fit=()=>{const m=current.current.terrain??empty;setCamera({x:m.width/2-.5,y:m.height/2-.5});setZoom(Math.max(.3,Math.min(2,Math.min((size.w-90)/((m.width+m.height)*(mode==='preview'?12:18)),(size.h-90)/((m.width+m.height)*(mode==='preview'?12:9))))))};
  const openFeature=(type:'spawn'|'interaction',at:Point,node?:GraphDocument['nodes'][number])=>{finish();setMenu(null);setFeature({type,at,id:node?.id??uid(),node})};
  const openTileMenu=(e:React.MouseEvent,at?:Point)=>{
    e.preventDefault();e.stopPropagation();if(mode!=='edit'||!stage.current)return;finish();
    const box=stage.current.getBoundingClientRect(),x=e.clientX-box.left,y=e.clientY-box.top,point=at??tileFrom(x,y);
    if(inside(current.current.terrain??empty,point))setMenu({at:point,x:Math.max(0,Math.min(x,size.w-265)),y:Math.max(0,Math.min(y,size.h-300))});else setMenu(null);
  };
  const askDelete=(target:NonNullable<typeof deletion>)=>{finish();confirmFocus.current=canvas.current;setMenu(null);setDeletion(target)};
  const deleteTileItem=()=>{
    if(!deletion)return;const before=current.current;
    const next=deletion.kind==='feature'?removeNodes(before,new Set([deletion.id])):{...before,terrain:paintClutter(before.terrain??empty,[deletion.at],null)};
    commit(next);if(current.current===next)setDeletion(null);
  };
  const menuClutter=menu?CLUTTER.find(c=>c.id===saved.clutter?.[menu.at.y*saved.width+menu.at.x]):undefined;
  useEffect(()=>{if(menu)menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()},[menu]);
  useEffect(()=>{const el=stage.current;if(!el)return;const observer=new ResizeObserver(()=>setSize({w:el.clientWidth,h:el.clientHeight}));observer.observe(el);return()=>observer.disconnect()},[mode]);
  useEffect(()=>{const el=canvas.current;if(!el)return;const wheel=(e:WheelEvent)=>{e.preventDefault();if(!resizeDrag.current)setZoom(z=>Math.max(.3,Math.min(3,z*Math.exp(-e.deltaY*.001))))};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel)},[mode]);
  const rendererState=useRef({shown,grid,view:{width:size.w,height:size.h,camera:viewCamera,zoom},tool,brush});
  rendererState.current={shown:stroke.current?.draft??shown,grid,view:{width:size.w,height:size.h,camera:viewCamera,zoom},tool,brush};
  useEffect(()=>{
    if(mode!=='edit'||!canvas.current)return;
    const renderer=new MapPixi(canvas.current);pixi.current=renderer;let closed=false;
    void renderer.init().then(()=>{
      if(closed)return;const latest=rendererState.current;renderer.setMap(latest.shown,latest.grid);renderer.setView(latest.view);
      renderer.setHover(latest.tool==='pan'||latest.tool==='resize'?null:hover.point,latest.tool==='brush'||latest.tool==='erase'?latest.brush:1);setError('');
    }).catch(e=>{if(!closed)setError('Map renderer unavailable: '+String(e))});
    return()=>{closed=true;renderer.destroy();if(pixi.current===renderer)pixi.current=null};
  },[mode]);
  useEffect(()=>{if(mode==='edit')pixi.current?.setMap(shown,grid);hover.update(hover.point,shown)},[shown,grid,mode]);
  useLayoutEffect(()=>{
    liveCamera.current=camera;
    if(markers.current)markers.current.style.transform='';
    if(resizeOverlay.current)resizeOverlay.current.style.transform='';
    if(mode==='edit')pixi.current?.setView({width:size.w,height:size.h,camera:viewCamera,zoom});
  },[camera,size,zoom,resizing,mode]);
  useEffect(()=>{if(mode==='edit')pixi.current?.setHover(tool==='pan'||tool==='resize'?null:hover.point,tool==='brush'||tool==='erase'?brush:1)},[tool,brush,mode,shown]);
  // The playable game's renderer remains confined to its separate, read-only 2D preview.
  useEffect(()=>{
    const el=canvas.current;if(!el||mode!=='preview'||!compiled||size.w<1||size.h<1)return;
    const ctx=el.getContext('2d');if(!ctx)return;
    const dpr=window.devicePixelRatio||1;el.width=Math.round(size.w*dpr);el.height=Math.round(size.h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#151619';ctx.fillRect(0,0,size.w,size.h);
    const cw=6*zoom,ch=12*zoom,w=Math.min(400,Math.ceil(size.w/cw)),h=Math.min(220,Math.ceil(size.h/ch));
    const ox=(size.w-w*cw)/2,oy=(size.h-h*ch)*.56;
    try{
      const frame=preview(compiled,camera,{w,h},night,roofs,actors),lines=frame.lines;
      previewTile.current=(x,y)=>frame.at(Math.floor((x-ox)/cw),Math.floor((y-oy)/ch));setPreviewError('');ctx.textBaseline='top';
      for(let y=0;y<lines.length;y++){let x=0;for(const span of lines[y]){ctx.font=`${span.bold?'bold ':''}${ch}px monospace`;for(const char of span.text){if(span.bg){ctx.fillStyle=span.bg;ctx.fillRect(ox+x*cw,oy+y*ch,cw+.3,ch+.3)}if(char!==' '){ctx.fillStyle=span.fg||'#d4d0c4';ctx.fillText(char,ox+x*cw,oy+y*ch,cw)}x++}}}
    }catch(e){previewTile.current=()=>undefined;setHover(null);setPreviewError(`Preview unavailable: ${String(e)}`)}
  },[compiled,actors,mode,size,camera,zoom,night,roofs]);
  const local=(e:React.PointerEvent<HTMLCanvasElement>)=>{const box=e.currentTarget.getBoundingClientRect();return {x:e.clientX-box.left,y:e.clientY-box.top}};
  const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(pan.current){
      const a=(e.clientX-pan.current.x)/unit.x,b=(e.clientY-pan.current.y)/unit.y;
      const next={x:pan.current.camera.x-(a-b)/2,y:pan.current.camera.y-(a+b)/2};liveCamera.current=next;
      if(mode==='edit'){
        pixi.current?.setView({width:size.w,height:size.h,camera:next,zoom});
        const dx=(camera.x-next.x+camera.y-next.y)*unit.x,dy=(camera.x-next.x-camera.y+next.y)*-unit.y;
        for(const el of [markers.current,resizeOverlay.current])if(el)el.style.transform=`translate(${dx}px,${dy}px)`;
        e.currentTarget.dataset.cameraX=String(next.x);e.currentTarget.dataset.cameraY=String(next.y);
      }else setCamera(next);
      return;
    }
    const pos=local(e),p=tileFrom(pos.x,pos.y);
    const s=stroke.current;
    if(s){const changed=s.move(p);if(changed.size)pixi.current?.patch(s.draft,changed)}
    setHover(mode==='preview'?previewTile.current(pos.x,pos.y)??null:p);
  };
  const down=(e:React.PointerEvent<HTMLCanvasElement>)=>{
    if(e.button!==0&&e.button!==1&&e.button!==2)return;e.preventDefault();e.currentTarget.focus();
    setMenu(null);if(e.button===2||mode==='edit'&&e.currentTarget.dataset.renderer!=='pixi')return;
    const pos=local(e),p=tileFrom(pos.x,pos.y);
    e.currentTarget.setPointerCapture(e.pointerId);
    if(mode==='preview'||tool==='pan'||tool==='resize'||e.button!==0){pan.current={x:e.clientX,y:e.clientY,camera:{...liveCamera.current}};setHover(null);return}
    const m=current.current.terrain??empty;if(!inside(m,p))return;
    if(tool==='sample'||e.altKey){if(layer==='clutter'){const id=m.clutter?.[p.y*m.width+p.x];if(id)setClutterMaterial(id);if(tool==='sample'||!id)setTool(id?'brush':'erase')}else{chooseMaterial(m.tiles[p.y*m.width+p.x]);if(tool==='sample')setTool(paletteSlot==='erase'?'erase':'brush')}return}
    // Choose once per gesture, so releasing a modifier mid-stroke never mixes materials.
    const id=tool==='erase'||e.ctrlKey||e.metaKey?eraseMaterial:material;
    const clutter=tool==='erase'||e.ctrlKey||e.metaKey?null:clutterMaterial;
    if(tool==='fill'){const next=layer==='clutter'?fillClutter(m,p,clutter):fill(m,p,id);if(!sameMap(m,next))commit({...current.current,terrain:next});return}
    const s=new MapStroke(m,p,layer==='clutter'?clutter:id,layer,brush,tool==='rectangle');stroke.current=s;
    pixi.current?.patch(s.draft,s.move(p));setHover(p);
  };
  const bounds=[{x:-.5,y:-.5},{x:shown.width-.5,y:-.5},{x:shown.width-.5,y:shown.height-.5},{x:-.5,y:shown.height-.5}].map(project);
  const handles:Array<{edge:MapEdge;at:Point;dx:number;dy:number;icon:string}>=[
    {edge:'north',at:{x:(shown.width-1)/2,y:-.5},dx:-1,dy:-1,icon:'↖'},
    {edge:'east',at:{x:shown.width-.5,y:(shown.height-1)/2},dx:1,dy:-1,icon:'↗'},
    {edge:'south',at:{x:(shown.width-1)/2,y:shown.height-.5},dx:1,dy:1,icon:'↘'},
    {edge:'west',at:{x:-.5,y:(shown.height-1)/2},dx:-1,dy:1,icon:'↙'},
  ];
  return <div className="km-workshop km-map" ref={root} tabIndex={-1} onPointerDown={e=>{if(menu&&!(e.target as HTMLElement).closest('.map-context-menu'))setMenu(null)}} onKeyDown={e=>{
    if(confirmation||deletion||feature||textTarget(e.target))return;
    if(menu){if(e.key==='Escape'){setMenu(null);canvas.current?.focus();e.preventDefault()}return}
    if(e.key==='Escape'){finish(true);e.preventDefault();return}
    if(resizeDrag.current){e.preventDefault();return}
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();if(e.key.toLowerCase()==='y'||e.shiftKey)redo();else undo();return}
    if(e.key==='Tab'&&(e.target===canvas.current||e.target===root.current)){e.preventDefault();e.stopPropagation();switchMode(mode==='edit'?'preview':'edit');return}
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const key=e.key.toUpperCase(),chosen=TOOLS.find(t=>t.key===key);if(chosen){chooseTool(chosen.id);e.preventDefault()}else if(key==='X'){swapMaterials();e.preventDefault();e.stopPropagation()}else if(key==='D'){finish();setMaterial('cobbles');setEraseMaterial('grass');e.preventDefault();e.stopPropagation()}else if(key==='F'){fit();e.preventDefault()}else if(key==='['||key===']'){setBrush(v=>Math.max(1,Math.min(5,v+(key===']'?1:-1))));e.preventDefault()}
  }}>
    <div className="map-body" inert={confirmation||deletion?true:undefined}>
      <header className="topbar"><span className="file-path">{host.filePath}</span><span>Autosaves to this file</span></header>
      <div className="map-heading"><div><div className="eyebrow">KINGMAKER / MAP WORKSHOP</div><h1>{doc.title}</h1></div><nav aria-label="Map views"><button aria-pressed={mode==='edit'} onClick={()=>switchMode('edit')}>Paint</button><button aria-pressed={mode==='preview'} onClick={()=>switchMode('preview')}>Game preview <kbd>Tab</kbd></button></nav></div>
      <div className="map-toolbar"><div>{mode==='edit'?TOOLS.map(t=><button key={t.id} aria-label={t.name} title={`${t.name} (${t.key})`} aria-pressed={tool===t.id} onClick={()=>chooseTool(t.id)}><span>{t.icon}</span>{t.name}<kbd>{t.key}</kbd></button>):<span className="map-hint">{mode==='preview'?'Actual game terrain renderer · read-only preview':'Named inputs, outputs and transitions'}</span>}</div><div><button aria-label="Undo map edit" disabled={!past.length} onClick={undo}>↶ Undo</button><button aria-label="Redo map edit" disabled={!future.length} onClick={redo}>↷ Redo</button></div></div>
      <div className="map-content">
        <aside className="map-palette">
          {mode==='edit'&&<>
            <details className="map-accordion" open><summary onClick={()=>{finish();setLayer('clutter')}}>Clutter {layer==='clutter'?'· painting':''}</summary><div className="map-materials">{CLUTTER.map(c=><button key={c.id} aria-label={`Paint clutter ${c.name}`} aria-pressed={layer==='clutter'&&clutterMaterial===c.id} onClick={()=>{finish();setLayer('clutter');setClutterMaterial(c.id);setTool('brush')}}><span style={{color:c.color}}>{c.glyph}</span>{c.name}</button>)}</div><p>Paint above terrain. E or Ctrl/Cmd-drag removes clutter only. One object per tile.</p></details>
            <details className="map-accordion"><summary>Spawn points & interactions ({features.length})</summary><p>Right-click a tile or marker to add, edit or delete. Click a marker to edit its details.</p>{features.map(n=><button className="map-feature-list" key={n.id} onClick={()=>openFeature(n.data.mapFeature!,n.data.mapAt!,n)}>{n.data.mapFeature==='spawn'?'↳':'⚡'} {n.data.title}<small>{n.data.mapAt!.x}, {n.data.mapAt!.y}{n.data.exitPort?` → ${n.data.exitPort}`:''}</small></button>)}</details>
          </>}
          <details className="map-accordion" open><summary onClick={()=>{finish();setLayer('terrain')}}>{mode==='edit'?`Terrain ${layer==='terrain'?'· painting':''}`:'Game preview'}</summary>
          <div className="eyebrow">{mode==='edit'?'TERRAIN PALETTE':'PREVIEW'}</div>
          {mode==='edit'?<><div className="map-paint-pair" role="group" aria-label="Paint and erase materials">
            <button className="map-material-slot" aria-label="Choose paint material" aria-pressed={paletteSlot==='paint'} onClick={()=>{finish();setPaletteSlot('paint');if(tool==='erase')setTool('brush')}}><span style={{background:selected.color}}/><span><small>PAINT</small><strong>{selected.name}</strong></span></button>
            <button className="map-material-slot" aria-label="Choose erase material" aria-pressed={paletteSlot==='erase'} onClick={()=>{finish();setPaletteSlot('erase')}}><span style={{background:eraseSelected.color}}/><span><small>ERASE</small><strong>{eraseSelected.name}</strong></span></button>
            <button className="map-swap-materials" aria-label="Swap paint and erase materials" title="Swap materials (X)" onClick={swapMaterials}>⇄ Swap <kbd>X</kbd></button>
            <small>Click a swatch, then pick below. Ctrl/Cmd-drag uses Erase.</small>
          </div><div className="eyebrow">CHOOSE {paletteSlot.toUpperCase()} MATERIAL</div><div className="map-materials">{PALETTE.map(p=><button key={p.id} aria-label={`${paletteSlot==='paint'?'Paint':'Erase'} ${p.name}`} aria-pressed={(paletteSlot==='paint'?material:eraseMaterial)===p.id} onClick={()=>chooseMaterial(p.id)}><span style={{background:p.color}}/>{p.name}</button>)}</div><label>Brush size <strong>{brush} × {brush}</strong><input aria-label="Brush size" type="range" min="1" max="5" value={brush} onChange={e=>setBrush(Number(e.target.value))}/></label><label className="map-check"><input type="checkbox" checked={grid} onChange={e=>setGrid(e.target.checked)}/>Show tile edges</label><p>Paint the ground footprint. Wall and roof symbols stay small so you can see and edit behind them.</p></>:<><label className="map-check"><input type="checkbox" checked={night} onChange={e=>setNight(e.target.checked)}/>Night lighting</label><label className="map-check"><input type="checkbox" checked={roofs} onChange={e=>setRoofs(e.target.checked)}/>Lift roofs</label><p>The game’s isometric terrain renderer, using these tiles. Characters, scene triggers and the browser’s door overlays are not included.</p><p>This file is not yet loaded by the playable game.</p></>}
          </details>
        </aside>
        <div className="map-stage" ref={stage}>
          <canvas key={mode} ref={canvas} tabIndex={0} aria-label={mode==='edit'?'Isometric terrain editor':'Isometric game preview'} data-mode={mode} data-layer={layer} data-camera-x={camera.x} data-camera-y={camera.y} data-zoom={zoom} data-width={shown.width} data-height={shown.height} onPointerDown={down} onPointerMove={move} onPointerUp={e=>{finish();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish()} onPointerLeave={()=>{if(!stroke.current)setHover(null)}} onContextMenu={e=>openTileMenu(e)}/>
          {mode==='edit'&&tool!=='resize'&&<div className="map-markers" ref={markers}>{features.map((n,i)=>{const at=n.data.mapAt!,p=project(at),offset=features.slice(0,i).filter(other=>other.data.mapAt!.x===at.x&&other.data.mapAt!.y===at.y).length;return <button key={n.id} className={`map-marker map-marker-${n.data.mapFeature}`} style={{left:p.x+offset*22,top:p.y-19}} title={`${n.data.title} (${at.x}, ${at.y})`} aria-label={`Edit ${n.data.mapFeature==='spawn'?'spawn point':'interaction'} ${n.data.title}`} onClick={()=>openFeature(n.data.mapFeature!,at,n)} onContextMenu={e=>openTileMenu(e,at)}>{n.data.mapFeature==='spawn'?'↳':'⚡'}</button>})}</div>}
          {menu&&<div className="map-context-menu" ref={menuRef} role="menu" aria-label={`Tile ${menu.at.x}, ${menu.at.y}`} style={{left:menu.x,top:menu.y}} onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll('button')),i=buttons.indexOf(document.activeElement as HTMLButtonElement),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus()}}}>
            <small>Tile {menu.at.x}, {menu.at.y} · {PALETTE.find(p=>p.id===saved.tiles[menu.at.y*saved.width+menu.at.x])?.name}</small>
            {features.filter(n=>n.data.mapAt!.x===menu.at.x&&n.data.mapAt!.y===menu.at.y).map(n=><React.Fragment key={n.id}>
              <small>{n.data.mapFeature==='spawn'?'Spawn point':'Interaction'} · {n.data.title}</small>
              <button role="menuitem" onClick={()=>openFeature(n.data.mapFeature!,menu.at,n)}>Edit {n.data.title}…</button>
              <button role="menuitem" className="danger" onClick={()=>askDelete({kind:'feature',id:n.id,title:n.data.title,type:n.data.mapFeature==='spawn'?'spawn point':'interaction'})}>Delete {n.data.title}…</button>
            </React.Fragment>)}
            {menuClutter&&<button role="menuitem" className="danger" onClick={()=>askDelete({kind:'clutter',at:menu.at,title:menuClutter.name})}>Delete {menuClutter.name} clutter…</button>}
            <button role="menuitem" onClick={()=>openFeature('spawn',menu.at)}>Add spawn point…</button>
            <button role="menuitem" onClick={()=>openFeature('interaction',menu.at)}>Add interaction…</button>
          </div>}
          {mode==='edit'&&tool==='resize'&&<div className="map-resize-overlay" ref={resizeOverlay}>
            <svg width="100%" height="100%" aria-hidden="true"><polygon points={bounds.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#f0d6a5" strokeWidth="2" strokeDasharray="6 4"/></svg>
            {handles.map(h=>{const p=project(h.at),normal=Math.hypot(unit.x,unit.y);return <button key={h.edge} className="map-resize-handle" data-edge={h.edge} aria-label={`Resize ${h.edge} edge`} title={`Drag ${h.edge} edge outward to grow, inward to crop. + / − adjusts one tile.`} style={{left:p.x+h.dx*unit.x/normal*24,top:p.y+h.dy*unit.y/normal*24}} onPointerDown={e=>resizeDown(e,h.edge)} onPointerMove={resizeMove} onPointerUp={resizeUp} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>{if(resizeDrag.current)finish(true)}} onKeyDown={e=>{if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();e.stopPropagation();if(!resizeDrag.current)proposeResize(resizeMap(current.current.terrain??empty,h.edge,e.key==='-'?-1:1),e.currentTarget)}}}>{h.icon} {h.edge[0].toUpperCase()}</button>})}
            <div className="map-resize-guide"><strong>{shown.width} × {shown.height}</strong>{resizing?` · ${resizing.amount>=0?'+':''}${resizing.amount} ${resizing.edge} tiles · release to apply · Esc cancels`:' · Drag an edge to resize · new tiles are grass · 4–64 per side'}</div>
          </div>}
          <div className="map-view-controls"><button aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(.3,z/1.2))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(3,z*1.2))}>+</button><button onClick={fit}>Fit <kbd>F</kbd></button></div>
          <div className="map-mode-label">{mode==='edit'?'AUTHORING · ISOMETRIC':'IN-GAME TERRAIN · ISOMETRIC'}</div>
          {!doc.terrain&&mode==='edit'&&tool!=='resize'&&<div className="map-empty-hint">A blank map, ready to paint.<br/><small>Right-click a tile to add spawn points and interactions.</small></div>}
        </div>
      </div>
      <footer className="map-status"><span>{shown.width} × {shown.height} tiles · 5 ft / tile<MapHover store={hover}/></span><span>{mode==='edit'?(layer==='clutter'?`Clutter: ${CLUTTER.find(c=>c.id===clutterMaterial)!.name} / Erase: empty · `:`Paint: ${selected.name} / Erase: ${eraseSelected.name} · `):''}{tool==='resize'&&mode==='edit'?'Drag edge handles to resize':'Drag to '+(mode==='preview'||tool==='pan'?'pan':tool==='erase'?'erase':'paint')} · Right-click: actions · Middle-drag: pan · Wheel: zoom · Tab: switch</span></footer>
      {error&&<div className="map-error" role="alert">{error}</div>}
      {mode==='preview'&&previewError&&<div className="map-error" role="alert">{previewError}</div>}
    </div>
    {confirmation&&pendingResize&&<ConfirmDialog title="Crop the map?" description={`This removes ${pendingResize.removed} tiles from the ${pendingResize.edge} edge, leaving a ${pendingResize.map.width} × ${pendingResize.map.height} map. Terrain, clutter, spawn points and interactions outside the new boundary will be lost. Scenario transitions using removed ports will need reconnecting. You can undo this.`} confirmLabel="Crop map" onCancel={()=>{setConfirmation(null);setPendingResize(null)}} onConfirm={()=>{applyResize(pendingResize);setConfirmation(null);setPendingResize(null)}} returnFocus={confirmFocus.current} fallbackFocus={root.current}/>}
    {deletion&&<ConfirmDialog title={`Delete “${deletion.title}”?`} description={deletion.kind==='feature'?`This removes the ${deletion.type} and its port, if any. Scenario transitions using that port will need reconnecting. Other items on this tile are kept. You can undo this.`:'This removes only the clutter on this tile. Terrain, spawn points and interactions are kept. You can undo this.'} confirmLabel={deletion.kind==='feature'?`Delete ${deletion.type}`:'Delete clutter'} onCancel={()=>setDeletion(null)} onConfirm={deleteTileItem} returnFocus={confirmFocus.current} fallbackFocus={root.current}/>}
    {feature&&<MapFeatureDialog key={feature.id} feature={feature} onClose={()=>{setFeature(null);canvas.current?.focus()}} onSave={values=>{const next=saveMapFeature(current.current,feature.id,feature.type,feature.at,values);commit(next);if(serializeDocument(current.current)!==serializeDocument(next))throw Error('Could not save this edit.');setFeature(null);canvas.current?.focus()}} onDelete={()=>{const next=removeNodes(current.current,new Set([feature.id]));commit(next);if(current.current===next){setFeature(null);canvas.current?.focus()}}}/>}
  </div>;
}
