import {inside,line,type MapData,type Point,type PaintId,type ClutterId} from './map-model';

/** One copy per gesture for undo; pointer moves touch only the brush/rectangle footprint. */
export class MapStroke {
  readonly draft:MapData;
  readonly touched=new Set<number>();
  private rectangle=new Set<number>();
  private last:Point|null=null;
  constructor(readonly base:MapData,readonly start:Point,readonly material:PaintId|ClutterId|null,readonly layer:'terrain'|'clutter',readonly size:number,readonly rectangular:boolean){
    this.draft=layer==='terrain'?{...base,tiles:[...base.tiles]}:{...base,clutter:base.clutter?[...base.clutter]:Array(base.width*base.height).fill(null)};
  }
  move(p:Point):Set<number>{
    const changed=new Set<number>();
    if(this.last?.x===p.x&&this.last?.y===p.y)return changed;
    const cells=this.layer==='terrain'?this.draft.tiles:this.draft.clutter!;
    const before=this.layer==='terrain'?this.base.tiles:this.base.clutter;
    const write=(i:number,value:PaintId|ClutterId|null)=>{if(cells[i]!==value){(cells as Array<PaintId|ClutterId|null>)[i]=value;changed.add(i);this.touched.add(i)}};
    if(this.rectangular){
      const next=new Set<number>();
      for(let y=Math.max(0,Math.min(this.start.y,p.y));y<=Math.min(this.base.height-1,Math.max(this.start.y,p.y));y++)for(let x=Math.max(0,Math.min(this.start.x,p.x));x<=Math.min(this.base.width-1,Math.max(this.start.x,p.x));x++)next.add(y*this.base.width+x);
      for(const i of this.rectangle)if(!next.has(i))write(i,before?.[i]??null);
      for(const i of next)write(i,this.material);
      this.rectangle=next;
    }else{
      const lo=-Math.floor((this.size-1)/2),hi=Math.ceil((this.size-1)/2);
      for(const a of line(this.last??p,p))for(let y=lo;y<=hi;y++)for(let x=lo;x<=hi;x++){const q={x:a.x+x,y:a.y+y};if(inside(this.base,q))write(q.y*this.base.width+q.x,this.material)}
    }
    this.last=p;return changed;
  }
  get changed(){const cells=this.layer==='terrain'?this.draft.tiles:this.draft.clutter!,before=this.layer==='terrain'?this.base.tiles:this.base.clutter;for(const i of this.touched)if(cells[i] !== (before?.[i]??null))return true;return false}
}
