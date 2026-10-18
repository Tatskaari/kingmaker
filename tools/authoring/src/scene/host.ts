import type {Campaign} from './campaign.ts';
import type {SceneDocument} from './model.ts';

/**
 * What the scene editor asks of whatever holds the file: Obsidian (plugin.tsx), or the browser test
 * harness (browser.tsx). The file is the source of truth: the editor hands every edit to `change`,
 * and the host saves it.
 */
export type SceneHost={
  /** The scene file's path in the vault. */
  filePath:string;
  /** The scene as edited: the host saves it (as model.ts's serializeScene writes it). */
  change:(doc:SceneDocument)=>void;
  /** The campaign around the file, read now. */
  campaign:()=>Promise<Campaign>;
  /** Called when another file of the vault changes (the campaign may have); returns its unsubscribe. */
  subscribe?:(listener:()=>void)=>()=>void;
  /** Open a lore note in the host's own editor, by the game's lore path (relative to the campaign's lore/). */
  openLore:(path:string)=>Promise<void>;
  /** Open another scene of the campaign, by its id. */
  openScene:(id:string)=>Promise<void>;
};
