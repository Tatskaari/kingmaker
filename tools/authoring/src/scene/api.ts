import {createContext,useContext} from 'react';
import type {Campaign,LoreKind} from './campaign.ts';
import type {SceneDocument} from './model.ts';
import type {PlaceFile} from '../../../../shared/scene/files.ts';

/** A request for a lore note: which kinds to offer, and what to do with the one picked. */
export type LoreRequest={title:string;kinds?:LoreKind[];linked:string[];onPick:(path:string)=>void};

/** A destructive action, asked about first. */
export type Confirmation={title:string;description:string;confirmLabel:string;onConfirm:()=>void};

/** What the scene editor's panels share: the scene, the campaign around it, and the ways to change them. */
export type SceneApi={
  doc:SceneDocument;
  campaign:Campaign|null;
  /** The scene's place (places/<key>.kmplace, as the game keeps it), when it has one the campaign knows. */
  place:PlaceFile|undefined;
  /** A lore path's name, for the notes the campaign has. */
  loreNames:Map<string,string>;
  /** An edit: `change` applied to the scene as it is now. Typing in one field is one step of undo. */
  edit:(change:(doc:SceneDocument)=>SceneDocument)=>void;
  openLore:(path:string)=>void;
  openScene:(id:string)=>void;
  /** Open the campaign's place by its key (places/<key>.kmplace). */
  openPlace:(key:string)=>void;
  pickLore:(request:LoreRequest)=>void;
  confirm:(confirmation:Confirmation)=>void;
  /** Show a node, a connection (by a route of it) or a person of the cast in the inspector. */
  showNode:(id:string)=>void;
  showRoute:(id:string)=>void;
  showCast:(id:string)=>void;
  /** Start drawing a route from a node: the next node clicked is where it goes. */
  connectFrom:(id:string)=>void;
  /** A route to open for editing when its connection is shown (a problem's, or one just added). */
  editingRoute:string|null;
  setEditingRoute:(id:string|null)=>void;
};

export const SceneApiContext=createContext<SceneApi|null>(null);

export function useScene():SceneApi{
  const api=useContext(SceneApiContext);
  if(!api)throw new Error('The scene editor\'s panels need its SceneApi.');
  return api;
}
