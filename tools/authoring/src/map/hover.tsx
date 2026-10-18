import {useSyncExternalStore} from 'react';
import {cellAt,entryName,inside} from './model.ts';
import type {Cells,LegendEntry,Tile2} from './model.ts';

/** Only this small readout follows the pointer: hovering never re-renders the map or the side panels. */
export class MapHoverStore {
  point:Tile2|null=null;
  private text='';
  private listeners=new Set<()=>void>();
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}};
  snapshot=()=>this.text;
  update(point:Tile2|null,cells:Cells,legend:Record<string,LegendEntry>){
    this.point=point;
    const p=point&&inside(cells,point)?point:null;
    const ch=p?cellAt(cells,p):'';
    const text=p?` · Hover: ${entryName(legend[ch])} ${ch===' '?'':`“${ch}” `}(${p.x}, ${p.y})`:'';
    if(this.text===text)return;
    this.text=text;
    for(const listener of this.listeners)listener();
  }
}

export function MapHover({store}:{store:MapHoverStore}){
  const text=useSyncExternalStore(store.subscribe,store.snapshot);
  return text?<span className="map-hover-tile">{text}</span>:null;
}
