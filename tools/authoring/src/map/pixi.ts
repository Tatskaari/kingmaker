// The painter's isometric view of a map's grid, in PixiJS (WebGL): a sprite a tile for its legend
// entry's look and one for its decor, made once and re-textured only where a stroke changes a tile.
import {Application,Container,Graphics,Rectangle,Sprite,Text,Texture} from 'pixi.js';
import type {Cells,LegendEntry,Tile2} from './model.ts';
import {inside} from './model.ts';
import {lookOf} from './look.ts';
import type {EntryLook} from './look.ts';

export type MapView={width:number;height:number;camera:Tile2;zoom:number};
const project=(x:number,y:number)=>({x:(x+y)*18,y:(y-x)*9});
/** The tile under a point of the canvas. */
export const mapTileAt=(view:MapView,x:number,y:number):Tile2=>{const a=(x-view.width/2)/(18*view.zoom),b=(y-view.height*.56)/(9*view.zoom);return {x:Math.floor(view.camera.x+(a-b)/2+.5),y:Math.floor(view.camera.y+(a+b)/2+.5)}};
/** The point of the canvas a tile's middle is at. */
export const mapPointOf=(view:MapView,p:{x:number;y:number})=>({x:view.width/2+(p.x-view.camera.x+p.y-view.camera.y)*18*view.zoom,y:view.height*.56+(p.y-view.camera.y-p.x+view.camera.x)*9*view.zoom});

const diamond=(g:Graphics,color:string,grid=false,raise=0)=>{g.poly([0,-9-raise,18,-raise,0,9-raise,-18,-raise]).fill(color);if(grid)g.stroke({color:0x182128,alpha:.35,width:.6})};
const line=(g:Graphics,x:number,y:number,a:number,b:number,color=0x243032)=>g.moveTo(x,y).lineTo(a,b).stroke({color,alpha:.75,width:1});

function tileGraphic(look:EntryLook,grid:boolean):Graphics{
  const g=new Graphics();
  if(look.shape==='void'){diamond(g,look.color,false);g.poly([0,-9,18,0,0,9,-18,0]).stroke({color:0x2c363a,alpha:.8,width:.6});return g}
  diamond(g,look.color,grid);
  if(look.shape==='water')g.moveTo(-5,0).quadraticCurveTo(0,-4,6,0).stroke({color:0x243032,alpha:.5,width:1});
  else if(look.shape==='tree')g.poly([0,-8,6,3,-6,3]).fill(look.top??'#2f5a2a');
  else if(look.shape==='block'||look.shape==='roof'){
    diamond(g,look.top??look.color,true,4);
    if(look.shape==='roof'){line(g,-6,-4,0,-9);line(g,0,-9,6,-4)}
    else if(look.mark==='door'){g.rect(-3,-8,6,9).fill('#5a4030').stroke({color:0x243032,width:1.2})}
    else if(look.mark==='window'){g.rect(-3,-8,6,7).fill('#88b7b9').stroke({color:0x243032,width:1.2});line(g,0,-8,0,-1)}
    else if(look.mark==='fence'){line(g,-7,-5,7,-5);for(const x of [-5,0,5])line(g,x,-8,x,-1)}
    else{line(g,-7,-5,7,-5);line(g,0,-8,0,-2)}
  }
  return g;
}

function decorGraphic(look:EntryLook):Container{
  const box=new Container();
  if(!look.decor)return box;
  const shadow=new Graphics();shadow.ellipse(0,2,8,4).fill({color:0x152026,alpha:.7});box.addChild(shadow);
  const text=new Text({text:look.decor.glyph,style:{fontFamily:'monospace',fontSize:15,fontWeight:'bold',fill:look.decor.color,stroke:{color:'#10161a',width:3}}});
  text.anchor.set(.5,.75);box.addChild(text);
  return box;
}

/** Persistent, non-interactive sprites. The canvas owns input; there's no tile hit-test traversal. */
export class MapPixi {
  private app=new Application();
  private world=new Container({isRenderGroup:true,eventMode:'none',interactiveChildren:false});
  private overlay=new Container({isRenderGroup:true,eventMode:'none',interactiveChildren:false});
  private cursor=new Graphics();
  private atlas:Texture|undefined;
  private textures=new Map<string,Texture>();
  private tiles:Sprite[]=[];
  private decor:Sprite[]=[];
  private cells:Cells|undefined;
  private legend:Record<string,LegendEntry>|undefined;
  private grid=true;
  private view:MapView|undefined;
  private hoverKey='';
  private pending=0;
  private disposed=false;
  private ready=false;
  readonly stats={frames:0,fullSyncs:0,tileChecks:0,tileUpdates:0,tileTransforms:0,tileCollections:0,viewUpdates:0,hoverUpdates:0,atlases:0};
  constructor(private canvas:HTMLCanvasElement){}
  async init(){
    await this.app.init({canvas:this.canvas,width:1,height:1,autoStart:false,sharedTicker:false,preference:'webgl',background:'#20272b',resolution:Math.min(2,window.devicePixelRatio||1),autoDensity:true,antialias:true});
    this.ready=true;
    if(this.disposed){this.disposeResources();return}
    this.app.stage.eventMode='none';this.app.stage.interactiveChildren=false;
    this.app.stage.addChild(this.world,this.overlay);this.overlay.addChild(this.cursor);
    // Diagnostics count Pixi's own per-tile transform work, not just the editor's loops.
    (this.canvas as HTMLCanvasElement&{__kmPixi?:unknown}).__kmPixi={stats:this.stats};
    this.canvas.dataset.renderer='pixi';
  }
  /** The textures for a legend: each entry's tile, with and without its edges, and its decor; and the void's. */
  private makeAtlas(legend:Record<string,LegendEntry>){
    for(const texture of this.textures.values())texture.destroy(false);
    this.textures.clear();this.atlas?.destroy(true);
    const shapes:Array<[string,Container]>=[];
    const entries:Array<[string,LegendEntry|undefined]>=[[' ',undefined],...Object.entries(legend)];
    for(const [ch,entry] of entries){
      const look=lookOf(entry);
      for(const grid of [false,true])shapes.push([`${ch}:${grid}`,tileGraphic(look,grid)]);
      if(look.decor)shapes.push([`decor:${ch}`,decorGraphic(look)]);
    }
    shapes.push(['empty',new Graphics()]);
    const columns=12,root=new Container();
    shapes.forEach(([,shape],i)=>{shape.position.set(i%columns*40+20,Math.floor(i/columns)*40+20);root.addChild(shape)});
    const atlas=this.app.renderer.generateTexture({target:root,frame:new Rectangle(0,0,columns*40,Math.ceil(shapes.length/columns)*40),resolution:2});
    this.atlas=atlas;this.stats.atlases++;
    shapes.forEach(([key],i)=>this.textures.set(key,new Texture({source:atlas.source,frame:new Rectangle(i%columns*40,Math.floor(i/columns)*40,40,40)})));
    root.destroy({children:true});
  }
  private sprite(x:number,y:number){
    const sprite=new Sprite(this.textures.get('empty'));sprite.anchor.set(.5);const p=project(x,y);sprite.position.set(p.x,p.y);sprite.eventMode='none';
    const update=sprite.updateLocalTransform;sprite.updateLocalTransform=()=>{this.stats.tileTransforms++;update.call(sprite)};
    const collect=sprite.collectRenderables;sprite.collectRenderables=(...args)=>{this.stats.tileCollections++;collect.apply(sprite,args)};
    this.world.addChild(sprite);return sprite;
  }
  /** The map's cells and legend: what's changed is re-textured, a new size rebuilds the sprites, a new legend the textures. */
  setMap(cells:Cells,legend:Record<string,LegendEntry>,grid:boolean){
    if(this.disposed||!this.ready)return;
    if(this.cells===cells&&this.legend===legend&&this.grid===grid)return;
    this.stats.fullSyncs++;
    const newLegend=this.legend!==legend&&JSON.stringify(this.legend)!==JSON.stringify(legend);
    if(newLegend||!this.atlas)this.makeAtlas(legend);
    const rebuild=!this.cells||cells.width!==this.cells.width||cells.height!==this.cells.height;
    if(rebuild){
      for(const child of this.world.removeChildren())child.destroy();this.tiles=[];this.decor=[];
      // Back to front: the far corner first, so nearer tiles and decor draw over it.
      for(let row=-(cells.width-1);row<cells.height;row++)for(let x=0;x<cells.width;x++){const y=row+x;if(y<0||y>=cells.height)continue;const i=y*cells.width+x;this.tiles[i]=this.sprite(x,y);this.decor[i]=this.sprite(x,y)}
    }
    const previous=this.cells,oldGrid=this.grid;this.grid=grid;this.legend=legend;
    for(let i=0;i<cells.cells.length;i++){this.stats.tileChecks++;if(rebuild||newLegend||oldGrid!==grid||previous?.cells[i]!==cells.cells[i])this.updateTile(cells,i)}
    this.cells=cells;this.hoverKey='';this.invalidate();
  }
  /** During a stroke the cells are a working copy: only the tiles it changed are read. */
  patch(cells:Cells,indices:Iterable<number>){
    if(this.disposed||!this.ready)return;
    for(const i of indices){this.stats.tileChecks++;this.updateTile(cells,i)}this.cells=cells;this.invalidate();
  }
  private updateTile(cells:Cells,i:number){
    const ch=cells.cells[i];
    const known=ch===' '||(this.legend&&ch in this.legend);
    this.tiles[i].texture=this.textures.get(`${known?ch:' '}:${this.grid}`)??this.textures.get('empty')!;
    this.decor[i].texture=this.textures.get(`decor:${ch}`)??this.textures.get('empty')!;
    this.stats.tileUpdates++;
  }
  setView(view:MapView){
    if(this.disposed||!this.ready)return;
    if(!this.view||this.view.width!==view.width||this.view.height!==view.height)this.app.renderer.resize(view.width,view.height);
    const p=project(view.camera.x,view.camera.y);
    for(const group of [this.world,this.overlay]){group.position.set(view.width/2-p.x*view.zoom,view.height*.56-p.y*view.zoom);group.scale.set(view.zoom)}
    this.view=view;this.stats.viewUpdates++;this.invalidate();
  }
  setHover(at:Tile2|null,size:number){
    if(this.disposed||!this.ready||!this.cells)return;
    const key=at?`${at.x},${at.y}:${size}`:'';if(key===this.hoverKey)return;this.hoverKey=key;this.stats.hoverUpdates++;
    this.cursor.clear();
    if(at&&inside(this.cells,at)){
      const p=project(at.x,at.y);this.cursor.position.set(p.x,p.y);
      const lo=-Math.floor((size-1)/2),hi=Math.ceil((size-1)/2);
      for(let y=lo;y<=hi;y++)for(let x=lo;x<=hi;x++)if(inside(this.cells,{x:at.x+x,y:at.y+y})){const q=project(x,y);this.cursor.poly([q.x,q.y-9,q.x+18,q.y,q.x,q.y+9,q.x-18,q.y]).fill({color:0xf9e3ab,alpha:.5}).stroke({color:0xffffff,width:.6})}
    }
    this.invalidate();
  }
  private invalidate(){if(this.disposed||this.pending)return;this.pending=requestAnimationFrame(()=>{this.pending=0;if(this.disposed)return;this.app.render();this.stats.frames++})}
  destroy(){this.disposed=true;if(this.pending)cancelAnimationFrame(this.pending);if(this.ready)this.disposeResources()}
  private disposeResources(){this.app.destroy({removeView:false},{children:true});for(const texture of this.textures.values())texture.destroy(false);this.textures.clear();this.atlas?.destroy(true);delete (this.canvas as HTMLCanvasElement&{__kmPixi?:unknown}).__kmPixi}
}
