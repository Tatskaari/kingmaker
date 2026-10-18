import React from 'react';
import type {GraphDocument,Host} from './model';
import {ScenarioEditor} from './ScenarioEditor';
import {MapEditor} from './MapEditor';
import {LegacyScene} from './scene/LegacyScene.tsx';
import {SceneApp} from './scene/SceneEditor.tsx';
import '@xyflow/react/dist/style.css';
import './styles.css';

export {LegacyScene,SceneApp};

/**
 * The editors for the plugin's own version 1 files, the scenario graph and the map, which M4 replaces.
 * Scenes are the game's files (.kmscene version 2) and have their own editor, SceneApp; a version 1
 * scene, the plugin's old graph, opens read-only.
 */
export function App({document,host}:{document:GraphDocument;host:Host}){
  if(document.kind==='scenario')return <ScenarioEditor document={document} host={host}/>;
  if(document.kind==='map')return <MapEditor document={document} host={host}/>;
  return <LegacyScene path={host.filePath} title={document.title} nodes={document.nodes.length} routes={document.edges.length}/>;
}
