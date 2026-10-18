// How the painter shows a legend entry: the game's own colours for its terrain and look (the
// renderer's palette, client/map/palette.ts), lifted for the authoring view, and the decor's glyph.
import {BLOCKS,DEFAULT_STYLE,GROUND,TREE,mix} from '../../../../client/map/palette.ts';
import {isStructure,tile as tileOf} from '../../../../shared/map/tiles.ts';
import type {LegendEntry} from './model.ts';

export type EntryLook={
  /** How its diamond is drawn: flat ground, water, a raised block (a wall, a door, a window, a fence), a roof over a floor, a tree, or the void. */
  shape:'ground'|'water'|'block'|'roof'|'tree'|'void';
  /** The diamond's colour, and a block's or roof's top. */
  color:string;
  top?:string;
  /** A door's or a window's mark on its block. */
  mark?:'door'|'window'|'fence';
  /** The decor standing on it: its glyph and colour. */
  decor?:{glyph:string;color:string};
};

const lift=(color:string|undefined,amount=.3)=>color?mix(color,'#ffffff',amount):'#808080';

/** An entry's look in the painter (undefined is the void, a tile with no entry). */
export function lookOf(entry:LegendEntry|undefined):EntryLook{
  if(!entry||entry.terrain==='void')return {shape:'void',color:'#151b1e'};
  const {terrain,decor,...extra}=entry;
  const t=tileOf(terrain,extra as Omit<LegendEntry,'terrain'|'decor'>);
  const decorLook=decor?{decor:{glyph:decor.glyph||'?',color:decor.color??'#d8d0c0'}}:{};
  const ground=GROUND[groundKey(t.terrain,t.style)]??GROUND.floor;
  if(t.terrain==='tree')return {shape:'tree',color:lift(ground.bg,.35),top:TREE.canopyFg,...decorLook};
  if(isStructure(t)){
    const block=BLOCKS[t.style??DEFAULT_STYLE[t.terrain]??'stone']??BLOCKS.stone;
    return {shape:'block',color:lift(block.west,.15),top:lift(block.top,.2),...(t.terrain==='door'||t.terrain==='window'||t.terrain==='fence'?{mark:t.terrain}:{}),...decorLook};
  }
  if(t.roof){
    const roof=BLOCKS[t.roof]??BLOCKS.stone;
    return {shape:'roof',color:lift(ground.bg,.3),top:lift(roof.top,.25),...decorLook};
  }
  if(t.terrain==='water'||t.terrain==='deep-water')return {shape:'water',color:lift(ground.bg,.25),...decorLook};
  return {shape:'ground',color:lift(ground.bg,.32),...decorLook};
}

/** The ground the renderer draws under a tile (render.ts groundKey). */
function groundKey(terrain:string,style:string|undefined):string{
  if(terrain==='floor'&&style&&GROUND[style])return style;
  if(terrain==='wall'||terrain==='window'||terrain==='door'||terrain==='fence'||terrain==='tree'||terrain==='void')return style&&GROUND[style]?style:'floor';
  return GROUND[terrain]?terrain:'floor';
}

/** A swatch's CSS background for an entry: its colour, a roof's or block's top over it. */
export function swatchOf(entry:LegendEntry|undefined):string{
  const look=lookOf(entry);
  return look.top?`linear-gradient(135deg, ${look.top} 0 50%, ${look.color} 50% 100%)`:look.color;
}
