import React from 'react';
import {Lock} from 'lucide-react';
import '../scene/scene.css';

/** A version 1 scenario file (the plugin's old graph of its own files): shown, never edited or saved. */
export function LegacyScenario({path,title,files}:{path:string;title:string;files:number}){
  return <div className="km-legacy-scene" role="note" aria-label="A version 1 scenario file">
    <h2><Lock size={18}/>{title||path}</h2>
    <p><b>This is a version 1 scenario file, and it opens read-only: the scenario format has moved on.</b> The game reads a campaign's scenario in the scenario format, version 2 (<code>docs/scenario-format.md</code>): one <code>&lt;id&gt;.kmscenario</code> at the campaign folder's root, its flow drawn from the scenes' endings and the maps' regions and exits. This file was the plugin's own graph of its version 1 files{files?` (it showed ${files})`:''}, and nothing loads it.</p>
    <p>The campaign's scenario is <code>campaigns/caerwyn/caerwyn.kmscenario</code>: open that campaign folder as your vault (the plugin's README says how). A version 1 map opens with an offer to migrate it.</p>
    <p className="muted">{path} is left exactly as it is.</p>
  </div>;
}
