import {useSyncExternalStore} from 'react';
import {CLUTTER,PALETTE,inside,type MapData,type Point} from './map-model';

/** Only this tiny readout subscribes. Hover must not re-render the map or the sidebar. */
export class MapHoverStore {
  point:Point|null=null;
  private text='';
  private listeners=new Set<()=>void>();
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}};
  snapshot=()=>this.text;
  update(point:Point|null,map:MapData){
    this.point=point;
    const p=point&&inside(map,point)?point:null;
    const terrain=p?PALETTE.find(t=>t.id===map.tiles[p.y*map.width+p.x]):null,clutter=p?CLUTTER.find(t=>t.id===map.clutter?.[p.y*map.width+p.x]):null;
    const text=p?` · Hover: ${terrain?.name} (${p.x}, ${p.y})${clutter?' · '+clutter.name:''}`:'';
    if(this.text===text)return;this.text=text;for(const listener of this.listeners)listener();
  }
}
export function MapHover({store}:{store:MapHoverStore}){const text=useSyncExternalStore(store.subscribe,store.snapshot);return text?<span className="map-hover-tile">{text}</span>:null}
