// Editing the campaign's JSON files as they are: every file of the game's formats (a scene, the
// scenario, a map, a place) is JSON.stringify(doc, null, 2) and a closing newline, so an editor keeps
// the parsed object and changes one value at a time, and an untouched file saves to the same bytes.

/** A file of the game's formats as it's written: two spaces to an indent and a closing newline. */
export const serializeJson=(doc:unknown):string=>JSON.stringify(doc,null,2)+'\n';

/**
 * An object with `key` set to `value`, or taken out when `value` is undefined. A key that's there
 * keeps its place; a new one goes before the first key `order` puts after it (keys `order` doesn't
 * know stay where they are). The same object comes back when nothing changes.
 */
export function withKey<T extends object>(object:T,key:string,value:unknown,order:readonly string[]):T{
  const entries=Object.entries(object);
  const at=entries.findIndex(([k])=>k===key);
  if(value===undefined)return at<0?object:Object.fromEntries(entries.filter(([k])=>k!==key)) as T;
  if(at>=0){
    if(Object.is(entries[at][1],value))return object;
    entries[at]=[key,value];
    return Object.fromEntries(entries) as T;
  }
  const rank=(k:string)=>{const i=order.indexOf(k);return i<0?-1:i};
  const mine=rank(key);
  const before=mine<0?-1:entries.findIndex(([k])=>rank(k)>mine);
  entries.splice(before<0?entries.length:before,0,[key,value]);
  return Object.fromEntries(entries) as T;
}

/** Several keys set at once, each as withKey sets it. */
export function withKeys<T extends object>(object:T,values:Record<string,unknown>,order:readonly string[]):T{
  return Object.entries(values).reduce((next,[key,value])=>withKey(next,key,value,order),object);
}

/** A text that's optional in the format: empty is no key at all. */
export const optionalText=(text:string):string|undefined=>text.trim()?text:undefined;
/** A list that's optional in the format: empty is no key at all. */
export const optionalList=<T,>(list:T[]):T[]|undefined=>list.length?list:undefined;

/** A slug of a title or a name ("The Hanged Clerk" → "the-hanged-clerk"), or "" when it has no letters or digits. */
export function slugOf(text:string):string{
  return text.normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48).replace(/-+$/,'');
}

/** `base`, or `base-2`, `base-3`… whichever isn't taken. */
export function uniqueId(base:string,taken:Iterable<string>):string{
  const used=new Set(taken),root=base||'node';
  if(!used.has(root))return root;
  for(let n=2;;n++)if(!used.has(`${root}-${n}`))return `${root}-${n}`;
}

/** A list with the item at `index` replaced by `item` (the same list when it's the same item). */
export const replaced=<T,>(list:T[],index:number,item:T):T[]=>list[index]===item?list:list.map((old,i)=>i===index?item:old);

/** A list with the item at `from` moved to `to`. */
export function moved<T>(list:T[],from:number,to:number):T[]{
  if(from===to||to<0||to>=list.length)return list;
  const next=[...list];
  const [item]=next.splice(from,1);
  next.splice(to,0,item);
  return next;
}
