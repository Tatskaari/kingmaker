import {Application,Container,Graphics,Rectangle,Sprite,Texture} from 'pixi.js';
import {PALETTE,CLUTTER,inside,type MapData,type Point} from './map-model';

export type MapView={width:number;height:number;camera:Point;zoom:number};
const project=(x:number,y:number)=>({x:(x+y)*18,y:(y-x)*9});
export const mapTileAt=(view:MapView,x:number,y:number):Point=>{const a=(x-view.width/2)/(18*view.zoom),b=(y-view.height*.56)/(9*view.zoom);return {x:Math.floor(view.camera.x+(a-b)/2+.5),y:Math.floor(view.camera.y+(a+b)/2+.5)}};
const diamond=(g:Graphics,color:string,grid=false,raise=0)=>{g.poly([0,-9-raise,18,-raise,0,9-raise,-18,-raise]).fill(color);if(grid)g.stroke({color:0x182128,alpha:.35,width:.6})};
const line=(g:Graphics,x:number,y:number,a:number,b:number)=>g.moveTo(x,y).lineTo(a,b).stroke({color:0x243032,alpha:.7,width:1});
function terrainGraphic(id:string,color:string,grid:boolean){
  const g=new Graphics();diamond(g,color,grid);
  if(id==='water'||id==='deep-water')g.moveTo(-5,0).quadraticCurveTo(0,-4,6,0).stroke({color:0x243032,alpha:.5,width:1});
  else if(['boards','bridge','stairs'].includes(id))for(let k=-1;k<=1;k++)line(g,-7,k*3,7,k*3);
  else if(['stone','timber','roof'].includes(id)){diamond(g,id==='roof'?'#c29990':'#d0c0a4',true,4);if(id==='roof'){line(g,-6,-4,0,-9);line(g,0,-9,6,-4)}else{line(g,-7,-5,7,-5);line(g,0,-8,0,-2)}}
  else if(id==='tree')g.poly([0,-8,6,3,-6,3]).fill(0x254736);
  else if(id==='door'||id==='window'){g.rect(-3,-6,6,9).stroke({color:0x243032,width:1.4});if(id==='window'){line(g,-3,-2,3,-2);line(g,0,-6,0,3)}}
  else if(id==='fence'){line(g,-7,-2,7,-2);for(const x of [-5,0,5])line(g,x,-6,x,3)}
  return g;
}
function clutterGraphic(id:string){
  const g=new Graphics();g.ellipse(0,1,8,4).fill({color:0x152026,alpha:.7});
  if(id==='lamp'){g.rect(-1,-5,2,8).fill(0xbba67c);g.rect(-3,-10,6,6).fill(0xffd27f).stroke({color:0x594825,width:1});}
  else if(id==='sign'){g.rect(-1,-4,2,8).fill(0x8b6748);g.rect(-7,-10,14,7).fill(0xdbc797).stroke({color:0x594825,width:1});line(g,-4,-6,4,-6)}
  else if(id==='barrel'){g.ellipse(0,-2,5,7).fill(0xb99068).stroke({color:0x594825,width:1});line(g,-5,-4,5,-4);line(g,-4,1,4,1)}
  else if(id==='crate'){g.rect(-6,-8,12,12).fill(0xbb9168).stroke({color:0x594825,width:1});line(g,-5,-7,5,3);line(g,5,-7,-5,3)}
  else{g.rect(-8,-4,16,4).fill(0xc3a57c);line(g,-6,0,-6,4);line(g,6,0,6,4)}
  return g;
}

/** Persistent, non-interactive sprites. The browser canvas owns input; no tile hit-test traversal. */
export class MapPixi {
  private app=new Application();
  private world=new Container({isRenderGroup:true,eventMode:'none',interactiveChildren:false});
  private overlay=new Container({isRenderGroup:true,eventMode:'none',interactiveChildren:false});
  private cursor=new Graphics();
  private atlas:Texture|undefined;
  private textures=new Map<string,Texture>();
  private tiles:Sprite[]=[];
  private clutter:Sprite[]=[];
  private map:MapData|undefined;
  private grid=true;
  private view:MapView|undefined;
  private hoverKey='';
  private pending=0;
  private disposed=false;
  private ready=false;
  readonly stats={frames:0,fullSyncs:0,tileChecks:0,tileUpdates:0,tileTransforms:0,tileCollections:0,viewUpdates:0,hoverUpdates:0};
  constructor(private canvas:HTMLCanvasElement){}
  async init(){
    await this.app.init({canvas:this.canvas,width:1,height:1,autoStart:false,sharedTicker:false,preference:'webgl',background:'#20272b',resolution:Math.min(2,window.devicePixelRatio||1),autoDensity:true,antialias:true});
    this.ready=true;
    if(this.disposed){this.disposeResources();return}
    this.app.stage.eventMode='none';this.app.stage.interactiveChildren=false;
    this.app.stage.addChild(this.world,this.overlay);this.overlay.addChild(this.cursor);
    this.makeAtlas();
    // Diagnostics count actual Pixi per-tile transform work, not just our own loops.
    (this.canvas as HTMLCanvasElement&{__kmPixi?:unknown}).__kmPixi={stats:this.stats};
    this.canvas.dataset.renderer='pixi';
  }
  private makeAtlas(){
    const shapes:Array<[string,Graphics]>=[];
    for(const grid of [false,true])for(const p of PALETTE)shapes.push([`${p.id}:${grid}`,terrainGraphic(p.id,p.color,grid)]);
    for(const p of CLUTTER)shapes.push([p.id,clutterGraphic(p.id)]);
    shapes.push(['empty',new Graphics()]);
    const root=new Container();for(let i=0;i<shapes.length;i++){const g=shapes[i][1];g.position.set(i%6*40+20,Math.floor(i/6)*40+20);root.addChild(g)}
    const atlas=this.app.renderer.generateTexture({target:root,frame:new Rectangle(0,0,240,Math.ceil(shapes.length/6)*40),resolution:2});this.atlas=atlas;
    for(let i=0;i<shapes.length;i++)this.textures.set(shapes[i][0],new Texture({source:atlas.source,frame:new Rectangle(i%6*40,Math.floor(i/6)*40,40,40)}));
    root.destroy({children:true});
  }
  private sprite(x:number,y:number){
    const sprite=new Sprite(this.textures.get('empty'));sprite.anchor.set(.5);const p=project(x,y);sprite.position.set(p.x,p.y);sprite.eventMode='none';
    const update=sprite.updateLocalTransform; sprite.updateLocalTransform=()=>{this.stats.tileTransforms++;update.call(sprite)};
    const collect=sprite.collectRenderables;sprite.collectRenderables=(...args)=>{this.stats.tileCollections++;collect.apply(sprite,args)};
    this.world.addChild(sprite);return sprite;
  }
  setMap(map:MapData,grid:boolean){
    if(this.disposed||!this.ready)return;
    if(this.map===map&&this.grid===grid)return;
    this.stats.fullSyncs++;
    const rebuild=!this.map||map.width!==this.map.width||map.height!==this.map.height;
    if(rebuild){
      for(const child of this.world.removeChildren())child.destroy();this.tiles=[];this.clutter=[];
      for(let row=-(map.width-1);row<map.height;row++)for(let x=0;x<map.width;x++){const y=row+x;if(y<0||y>=map.height)continue;const i=y*map.width+x;this.tiles[i]=this.sprite(x,y);this.clutter[i]=this.sprite(x,y)}
    }
    const previous=this.map,oldGrid=this.grid;this.grid=grid;
    for(let i=0;i<map.tiles.length;i++){this.stats.tileChecks++;if(rebuild||oldGrid!==grid||previous?.tiles[i]!==map.tiles[i]||(previous?.clutter?.[i]??null)!==(map.clutter?.[i]??null))this.updateTile(map,i)}
    this.map=map;this.hoverKey='';this.invalidate();
  }
  /** During a brush gesture the working array is mutable; only explicit dirty indices are read. */
  patch(map:MapData,indices:Iterable<number>){
    if(this.disposed||!this.ready)return;
    for(const i of indices){this.stats.tileChecks++;this.updateTile(map,i)}this.map=map;this.invalidate();
  }
  private updateTile(map:MapData,i:number){
    this.tiles[i].texture=this.textures.get(`${map.tiles[i]}:${this.grid}`)!;
    this.clutter[i].texture=this.textures.get(map.clutter?.[i]??'empty')!;this.stats.tileUpdates++;
  }
  setView(view:MapView){
    if(this.disposed||!this.ready)return;
    if(!this.view||this.view.width!==view.width||this.view.height!==view.height)this.app.renderer.resize(view.width,view.height);
    const p=project(view.camera.x,view.camera.y);
    for(const group of [this.world,this.overlay]){group.position.set(view.width/2-p.x*view.zoom,view.height*.56-p.y*view.zoom);group.scale.set(view.zoom)}
    this.view=view;this.stats.viewUpdates++;this.invalidate();
  }
  setHover(at:Point|null,size:number){
    if(this.disposed||!this.ready||!this.map)return;
    const key=at?`${at.x},${at.y}:${size}`:'';if(key===this.hoverKey)return;this.hoverKey=key;this.stats.hoverUpdates++;
    this.cursor.clear();
    if(at&&inside(this.map,at)){
      const p=project(at.x,at.y);this.cursor.position.set(p.x,p.y);
      const lo=-Math.floor((size-1)/2),hi=Math.ceil((size-1)/2);
      for(let y=lo;y<=hi;y++)for(let x=lo;x<=hi;x++)if(inside(this.map,{x:at.x+x,y:at.y+y})){const q=project(x,y);this.cursor.poly([q.x,q.y-9,q.x+18,q.y,q.x,q.y+9,q.x-18,q.y]).fill({color:0xf9e3ab,alpha:.5}).stroke({color:0xffffff,width:.6})}
    }
    this.invalidate();
  }
  private invalidate(){if(this.disposed||this.pending)return;this.pending=requestAnimationFrame(()=>{this.pending=0;if(this.disposed)return;this.app.render();this.stats.frames++})}
  destroy(){this.disposed=true;if(this.pending)cancelAnimationFrame(this.pending);if(this.ready)this.disposeResources()}
  private disposeResources(){this.app.destroy({removeView:false},{children:true});for(const texture of this.textures.values())texture.destroy(false);this.textures.clear();this.atlas?.destroy(true);delete (this.canvas as HTMLCanvasElement&{__kmPixi?:unknown}).__kmPixi}
}
