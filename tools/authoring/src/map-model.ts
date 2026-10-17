/** Authored tiles, not generated scenery. Palette ids are stable file-format values. */
export const PALETTE=[
  {id:'grass',name:'Grass',color:'#5e7854',terrain:'grass'},
  {id:'dirt',name:'Dirt',color:'#977754',terrain:'dirt'},
  {id:'cobbles',name:'Cobbles',color:'#92918d',terrain:'cobbles'},
  {id:'boards',name:'Boards',color:'#a9865e',terrain:'boards'},
  {id:'water',name:'Water',color:'#568ba2',terrain:'water'},
  {id:'deep-water',name:'Deep water',color:'#355a76',terrain:'deep-water',blocks:true},
  {id:'bridge',name:'Bridge',color:'#c0a16f',terrain:'bridge'},
  {id:'stone',name:'Stone wall',color:'#afb0b0',terrain:'wall',style:'stone',height:3,blocks:true,opaque:true},
  {id:'timber',name:'Timber wall',color:'#b58d75',terrain:'wall',style:'timber',height:3,blocks:true,opaque:true},
  {id:'door',name:'Door',color:'#b99a65',terrain:'door',style:'timber',height:3,opaque:true},
  {id:'window',name:'Window',color:'#88b7b9',terrain:'window',style:'stone',height:3,blocks:true},
  {id:'roof',name:'Roofed floor',color:'#a77773',terrain:'boards',roof:'brick',roofHeight:3},
  {id:'tree',name:'Tree',color:'#38664d',terrain:'tree',height:2,blocks:true,opaque:true},
  {id:'fence',name:'Fence',color:'#aa9270',terrain:'fence',height:1,blocks:true},
  {id:'stairs',name:'Stairs',color:'#b2a99a',terrain:'stairs'},
] as const;
export type PaintId=typeof PALETTE[number]['id'];
export const CLUTTER=[
  {id:'lamp',name:'Lamp',glyph:'¤',color:'#ffd27f',states:['lamp','lit','post'],blocks:false},
  {id:'sign',name:'Sign',glyph:'T',color:'#dbc797',states:['sign'],blocks:false},
  {id:'crate',name:'Crate',glyph:'▣',color:'#bb9168',states:['crate'],blocks:true},
  {id:'barrel',name:'Barrel',glyph:'o',color:'#b99068',states:['barrel'],blocks:true},
  {id:'bench',name:'Bench',glyph:'▬',color:'#c3a57c',states:['bench'],blocks:true},
] as const;
export type ClutterId=typeof CLUTTER[number]['id'];
export type MapData={version:1;width:number;height:number;tiles:PaintId[];clutter?:Array<ClutterId|null>};
export type Point={x:number;y:number};
export type MapEdge='north'|'east'|'south'|'west';
export type MapResize={map:MapData;offset:Point;edge:MapEdge;amount:number;removed:number};
/** Positive amounts extend an edge; negative amounts crop it. Existing tiles are copied exactly. */
export function resizeMap(m:MapData,edge:MapEdge,amount:number):MapResize{
  validateMap(m);
  if(!['north','east','south','west'].includes(edge)||!Number.isInteger(amount))throw Error('Choose a map edge and a whole number of tiles.');
  const horizontal=edge==='east'||edge==='west',length=horizontal?m.width:m.height;
  const delta=Math.max(4-length,Math.min(64-length,amount));
  const width=m.width+(horizontal?delta:0),height=m.height+(horizontal?0:delta);
  const offset={x:edge==='west'?delta:0,y:edge==='north'?delta:0};
  const tiles:PaintId[]=Array(width*height).fill('grass');
  for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){const nx=x+offset.x,ny=y+offset.y;if(nx>=0&&ny>=0&&nx<width&&ny<height)tiles[ny*width+nx]=m.tiles[y*m.width+x]}
  const clutter=m.clutter?Array<ClutterId|null>(width*height).fill(null):undefined;
  if(clutter)for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){const nx=x+offset.x,ny=y+offset.y;if(nx>=0&&ny>=0&&nx<width&&ny<height)clutter[ny*width+nx]=m.clutter![y*m.width+x]}
  return {map:{...m,width,height,tiles,...(clutter?{clutter}:{})},offset,edge,amount:delta,removed:Math.max(0,m.width*m.height-width*height)};
}
export const blankMap=(width=32,height=24):MapData=>({version:1,width,height,tiles:Array(width*height).fill('grass')});
export function validateMap(value:unknown):asserts value is MapData{
  const m=value as MapData;
  if(!m||m.version!==1||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<4||m.height<4||m.width>64||m.height>64||!Array.isArray(m.tiles)||m.tiles.length!==m.width*m.height||m.tiles.some(t=>!PALETTE.some(p=>p.id===t)))throw Error('Invalid map terrain. Expected version 1, a 4–64 tile grid, and a supported palette id for every tile.');
  if(m.clutter!==undefined&&(!Array.isArray(m.clutter)||m.clutter.length!==m.width*m.height||m.clutter.some(t=>t!==null&&!CLUTTER.some(p=>p.id===t))))throw Error('Invalid clutter layer. Expected one supported clutter id or null per tile.');
}
export const inside=(m:MapData,p:Point)=>p.x>=0&&p.y>=0&&p.x<m.width&&p.y<m.height;
export const line=(a:Point,b:Point):Point[]=>{const n=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y));return Array.from({length:n+1},(_,i)=>({x:Math.round(a.x+(b.x-a.x)*i/(n||1)),y:Math.round(a.y+(b.y-a.y)*i/(n||1))}))};
export function paint(m:MapData,points:Point[],id:PaintId,size=1):MapData{
  const tiles=[...m.tiles],low=-Math.floor((size-1)/2),high=Math.ceil((size-1)/2);
  for(const p of points)for(let dy=low;dy<=high;dy++)for(let dx=low;dx<=high;dx++){const q={x:p.x+dx,y:p.y+dy};if(inside(m,q))tiles[q.y*m.width+q.x]=id}
  return {...m,tiles};
}
export function rectangle(m:MapData,a:Point,b:Point,id:PaintId){const points:Point[]=[];for(let y=Math.max(0,Math.min(a.y,b.y));y<=Math.min(m.height-1,Math.max(a.y,b.y));y++)for(let x=Math.max(0,Math.min(a.x,b.x));x<=Math.min(m.width-1,Math.max(a.x,b.x));x++)points.push({x,y});return paint(m,points,id)}
export function fill(m:MapData,p:Point,id:PaintId){if(!inside(m,p))return m;const before=m.tiles[p.y*m.width+p.x];if(before===id)return m;const tiles=[...m.tiles],todo=[p];tiles[p.y*m.width+p.x]=id;while(todo.length){const a=todo.pop()!;for(const q of [{x:a.x-1,y:a.y},{x:a.x+1,y:a.y},{x:a.x,y:a.y-1},{x:a.x,y:a.y+1}])if(inside(m,q)&&tiles[q.y*m.width+q.x]===before){tiles[q.y*m.width+q.x]=id;todo.push(q)}}return {...m,tiles}}
/** Clutter tools change only the overlay, never terrain underneath it. */
export function paintClutter(m:MapData,points:Point[],id:ClutterId|null,size=1):MapData{
  const clutter=m.clutter?[...m.clutter]:Array<ClutterId|null>(m.width*m.height).fill(null),lo=-Math.floor((size-1)/2),hi=Math.ceil((size-1)/2);
  for(const p of points)for(let y=lo;y<=hi;y++)for(let x=lo;x<=hi;x++){const q={x:p.x+x,y:p.y+y};if(inside(m,q))clutter[q.y*m.width+q.x]=id}
  return {...m,clutter};
}
export function rectangleClutter(m:MapData,a:Point,b:Point,id:ClutterId|null){const points:Point[]=[];for(let y=Math.max(0,Math.min(a.y,b.y));y<=Math.min(m.height-1,Math.max(a.y,b.y));y++)for(let x=Math.max(0,Math.min(a.x,b.x));x<=Math.min(m.width-1,Math.max(a.x,b.x));x++)points.push({x,y});return paintClutter(m,points,id)}
export function fillClutter(m:MapData,p:Point,id:ClutterId|null){
  if(!inside(m,p))return m;const before=m.clutter?.[p.y*m.width+p.x]??null;if(before===id)return m;
  const clutter=m.clutter?[...m.clutter]:Array<ClutterId|null>(m.width*m.height).fill(null),todo=[p];clutter[p.y*m.width+p.x]=id;
  while(todo.length){const a=todo.pop()!;for(const q of [{x:a.x-1,y:a.y},{x:a.x+1,y:a.y},{x:a.x,y:a.y-1},{x:a.x,y:a.y+1}])if(inside(m,q)&&clutter[q.y*m.width+q.x]===before){clutter[q.y*m.width+q.x]=id;todo.push(q)}}return {...m,clutter};
}
export const sameMap=(a:MapData,b:MapData)=>a.width===b.width&&a.height===b.height&&a.tiles.every((t,i)=>t===b.tiles[i]&&(a.clutter?.[i]??null)===(b.clutter?.[i]??null));
export function gameClutter(m:MapData,map:string){return (m.clutter??[]).flatMap((id,i)=>{const p=CLUTTER.find(p=>p.id===id);return p?[{id:`clutter:${i}`,name:p.name,kind:'object' as const,glyph:p.glyph,color:p.color,states:[...p.states],blocks:p.blocks,map,at:{x:i%m.width,y:Math.floor(i/m.width)}}]:[]})}
export function gameMap(m:MapData,id:string,name:string){return {id,name,width:m.width,height:m.height,tiles:Array.from({length:m.height},(_row,y)=>Array.from({length:m.width},(_column,x)=>{const {id:paletteId,name:paletteName,color,...tile}=PALETTE.find(p=>p.id===m.tiles[y*m.width+x])!;return {...tile}})),regions:[],exits:[]}}
/** Explicit example, never silently inserted into an existing file. */
export function harbourMap(){let m=blankMap();m=rectangle(m,{x:0,y:17},{x:31,y:23},'water');m=rectangle(m,{x:0,y:21},{x:31,y:23},'deep-water');m=rectangle(m,{x:2,y:13},{x:29,y:16},'cobbles');m=rectangle(m,{x:15,y:2},{x:17,y:19},'cobbles');m=rectangle(m,{x:22,y:17},{x:24,y:21},'boards');for(const [x,y,w,h] of [[5,5,6,6],[20,5,7,6],[4,0,7,3]]){m=rectangle(m,{x,y},{x:x+w,y:y+h},'stone');m=rectangle(m,{x:x+1,y:y+1},{x:x+w-1,y:y+h-1},'roof');m=paint(m,[{x:x+Math.floor(w/2),y:y+h}],'door');m=paint(m,[{x:x+1,y:y+h},{x:x+w-1,y:y+h}],'window')}m=rectangle(m,{x:12,y:7},{x:14,y:9},'dirt');for(const [x,y] of [[1,2],[2,5],[1,10],[29,2],[30,5],[29,10],[12,3]])m=paint(m,[{x,y}],'tree');return m}
