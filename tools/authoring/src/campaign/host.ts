import type {VaultFiles} from './files.ts';

/**
 * What the scenario, map and place editors ask of whatever holds the file: Obsidian (plugin.tsx), or
 * the browser test harness (browser.tsx). The file is the source of truth: the editor hands every
 * edit of its own file to `change`, and the host saves it. An edit of another file of the campaign (a
 * scene's ending, a map's region, the scenario's start, a place's things) is written to that file
 * with `write`, which refuses when the file isn't what the editor read any more: on disk, or in an
 * editor that has it open (which is given the new text, as if it changed outside it).
 */
export type FileHost<T=unknown>={
  /** The file's path in the vault. */
  filePath:string;
  /** The file as edited: the host saves it (as JSON, two spaces to an indent and a closing newline). */
  change:(doc:T)=>void;
  /** The vault's files: the paths under a folder, and a file's text as it is now (an open editor's draft first). */
  files:VaultFiles;
  /** Another file written: refused unless it's `before` now (on disk, or in an editor that has it open). */
  write:(path:string,before:string,after:string)=>Promise<void>;
  /** A new file, refused when there's one there already. */
  create:(path:string,text:string)=>Promise<void>;
  /** Called when a file of the vault changes; returns its unsubscribe. */
  subscribe:(listener:()=>void)=>()=>void;
  /** Open a file of the vault in its own tab. */
  open:(path:string)=>Promise<void>;
};

/** What a version 1 map's view asks of its host besides: its own file replaced by its migration (the view then opens it as a map of the format). */
export type MigrationHost=FileHost<unknown>&{replace:(text:string)=>void};
