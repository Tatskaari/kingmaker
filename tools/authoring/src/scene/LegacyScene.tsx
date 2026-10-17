import React from 'react';
import {Lock} from 'lucide-react';
import './scene.css';

/** A version 1 scene file (the plugin's old graph, with its imported snapshot): shown, never edited or saved. */
export function LegacyScene({path,title,nodes,routes}:{path:string;title:string;nodes:number;routes:number}){
  return <div className="km-legacy-scene" role="note" aria-label="A version 1 scene file">
    <h2><Lock size={18}/>{title||path}</h2>
    <p><b>This is a version 1 scene file, and it opens read-only: the scene format has moved on.</b> The game reads scenes in the scene format, version 2 (<code>docs/scene-format.md</code>), one file a scene in a campaign's <code>scenes/</code> folder, and this plugin edits those. This file was the plugin's own graph ({nodes} nodes, {routes} routes) and nothing loads it.</p>
    <p>The campaign's scenes are in <code>campaigns/caerwyn/scenes/</code>: open that campaign folder as your vault (the plugin's README says how). The Hanged Clerk's version 2 draft became <code>campaigns/caerwyn/scenes/hanged-clerk.kmscene</code>.</p>
    <p className="muted">{path} is left exactly as it is.</p>
  </div>;
}
