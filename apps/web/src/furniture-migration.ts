import type { Scenario } from "../../../packages/contracts/src/index.js";
import { locatedItems } from "../../../packages/core/src/inventory.js";
import { palaceLayout } from "./palace-layout.js";

/** Add authored furnishings once, never refill containers or respawn taken items. */
export function migratePalaceFurniture(saved: Scenario, authored: Scenario): void {
  const world = saved.world, target = authored.world;
  if (!world || !target || saved.id !== authored.id || target.facts?.palaceFurnishingsVersion !== 1
    || world.facts?.palaceFurnishingsVersion === 1) return;
  const ids = new Set(locatedItems(saved).map(item => item.id));
  for (const fixture of target.fixtures.filter(item => item.id.startsWith("furn_"))) {
    if (world.fixtures.some(item => item.id === fixture.id)) continue;
    const addition = structuredClone(fixture);
    if (addition.inventory) addition.inventory.items = addition.inventory.items.filter(item => !ids.has(item.id));
    for (const item of addition.inventory?.items ?? []) ids.add(item.id);
    world.fixtures.push(addition);
  }
  const occupied = new Set(world.fixtures.flatMap(f => f.position ? [`${f.position.x},${f.position.y}`] : []));
  const closed = new Set(world.doors.filter(d => !d.open).flatMap(d => d.tiles.map(p => `${p.x},${p.y}`)));
  for (const actor of world.actors) {
    const start = actor.position;
    if (!start || !occupied.has(`${start.x},${start.y}`)) continue;
    const candidates = [...palaceLayout.owners].filter(([key, room]) => room === actor.roomId && !occupied.has(key) && !closed.has(key))
      .map(([key]) => { const [x, y] = key.split(",").map(Number) as [number, number]; return { x, y }; })
      .sort((a, b) => Math.abs(a.x - start.x) + Math.abs(a.y - start.y) - Math.abs(b.x - start.x) - Math.abs(b.y - start.y));
    const destination = candidates.find(p => !world.actors.some(other => other !== actor && other.position?.x === p.x && other.position.y === p.y));
    if (destination) { start.x = destination.x; start.y = destination.y; }
  }
  world.facts = { ...world.facts, palaceFurnishingsVersion: 1 };
  world.revision++;
}
