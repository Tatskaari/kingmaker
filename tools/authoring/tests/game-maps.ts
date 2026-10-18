// The game's own code for a map, for the tests: a map file built as the game builds it (shared/map/tiles.ts mapOf).
import {asMapFile} from '../../../shared/scene/scenario.ts';
import type {MapDocument} from '../../../shared/scene/scenario.ts';
import {mapOf} from '../../../shared/map/tiles.ts';

export const build=(doc:MapDocument)=>mapOf(asMapFile(doc)).map;
export const terrainsOf=(doc:MapDocument)=>[...new Set(build(doc).tiles.flat().map(tile=>tile.terrain))];
export const decorOf=(doc:MapDocument)=>mapOf(asMapFile(doc)).decor;
