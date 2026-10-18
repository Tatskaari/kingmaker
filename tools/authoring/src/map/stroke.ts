import {inside,line} from './model.ts';
import type {Cells,Tile2} from './model.ts';

/** One gesture of painting: a copy of the cells for its undo, and pointer moves that touch only the brush's or the rectangle's tiles. */
export class MapStroke {
  readonly draft:Cells;
  readonly touched=new Set<number>();
  private rectangle=new Set<number>();
  private last:Tile2|null=null;
  constructor(readonly base:Cells,readonly start:Tile2,readonly ch:string,readonly size:number,readonly rectangular:boolean){
    this.draft={...base,cells:[...base.cells]};
  }
  /** The stroke carried on to `p`: the tiles it changed. */
  move(p:Tile2):Set<number>{
    const changed=new Set<number>();
    if(this.last?.x===p.x&&this.last?.y===p.y)return changed;
    const cells=this.draft.cells,before=this.base.cells,width=this.base.width;
    const write=(i:number,ch:string)=>{if(cells[i]!==ch){cells[i]=ch;changed.add(i);this.touched.add(i)}};
    if(this.rectangular){
      const next=new Set<number>();
      for(let y=Math.max(0,Math.min(this.start.y,p.y));y<=Math.min(this.base.height-1,Math.max(this.start.y,p.y));y++)for(let x=Math.max(0,Math.min(this.start.x,p.x));x<=Math.min(width-1,Math.max(this.start.x,p.x));x++)next.add(y*width+x);
      for(const i of this.rectangle)if(!next.has(i))write(i,before[i]);
      for(const i of next)write(i,this.ch);
      this.rectangle=next;
    }else{
      const lo=-Math.floor((this.size-1)/2),hi=Math.ceil((this.size-1)/2);
      for(const a of line(this.last??p,p))for(let y=lo;y<=hi;y++)for(let x=lo;x<=hi;x++){const q={x:a.x+x,y:a.y+y};if(inside(this.base,q))write(q.y*width+q.x,this.ch)}
    }
    this.last=p;return changed;
  }
  /** Did the stroke change anything, all told? */
  get changed(){for(const i of this.touched)if(this.draft.cells[i]!==this.base.cells[i])return true;return false}
}
