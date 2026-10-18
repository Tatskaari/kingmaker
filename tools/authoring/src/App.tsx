import '@xyflow/react/dist/style.css';
import './styles.css';
export {LegacyScene} from './scene/LegacyScene.tsx';
export {SceneApp} from './scene/SceneEditor.tsx';
export {ScenarioApp} from './scenario/ScenarioEditor.tsx';
export {LegacyScenario} from './scenario/LegacyScenario.tsx';
export {MapApp} from './map/MapEditor.tsx';
export {MapMigration} from './map/Migration.tsx';
export {PlaceApp} from './place/PlaceEditor.tsx';

/**
 * The plugin's editors, one for each kind of the game's files: a scene (.kmscene), the scenario
 * (.kmscenario), a map (.kmmap) and a place (.kmplace), each the format's version 2 and edited as the
 * game loads it. The plugin's own version 1 files open read-only (a scene, a scenario), or with the
 * offer to migrate (a map).
 */
