# Game music assignments

These are editable copies of the current Caerwyn campaign, in the game’s version 2 format. They leave the older drafts in the vault’s Scenes and Maps folders alone.

Open a file in `scenes/`, choose **Scene**, then **Music**. For a file in `maps/`, choose **Map**, then **Music**. Each has Morning, Afternoon, Evening, Night, Next morning, and Combat choices, drawing from the vault’s `Tunes/` folder. The scene’s choice takes priority over the map’s; clear a choice to inherit the map or game default.

The initial assignments reproduce the existing soundtrack: scenes use `scene`, maps use `town`, evening and night use `night`, and combat uses `fight`. The companion conversation uses `between`. Tune IDs are filenames relative to `Tunes/`, without `.kmtune`; nested folders work too.

The web build reads these music assignments by their existing scene and map IDs. Music edits here take effect with the next web build and page reload. Changes to other story or map fields still follow the normal campaign installation workflow. Supporting lore, places, looks and scenario files are included so the authoring editors can resolve the campaign’s references.
