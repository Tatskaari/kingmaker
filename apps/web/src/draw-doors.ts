import type { Point } from "./navigation.js";

export function drawDoors(context: CanvasRenderingContext2D, doors: readonly { tiles: readonly Point[]; open: boolean }[], showSolids = false): void {
  for (const door of doors) {
    const first = door.tiles[0]!, vertical = door.tiles[1]!.y !== first.y;
    context.save();
    context.translate(first.x * 16 + 8, first.y * 16 + 8);
    if (vertical) context.rotate(Math.PI / 2);
    // Two leaves fill a two-tile threshold. Open leaves fold against the jambs.
    context.fillStyle = "#35241d";
    context.fillRect(-8, -6, 3, 12); context.fillRect(21, -6, 3, 12);
    if (door.open) {
      context.fillStyle = "#b77943";
      context.fillRect(-5, -6, 3, 12); context.fillRect(18, -6, 3, 12);
    } else {
      context.fillStyle = "#583522"; context.fillRect(-5, -5, 26, 10);
      context.fillStyle = "#b77943"; context.fillRect(-4, -4, 11, 8); context.fillRect(9, -4, 11, 8);
      context.fillStyle = "#e9c276"; context.fillRect(4, -1, 2, 2); context.fillRect(10, -1, 2, 2);
      context.fillStyle = "#45362b"; context.fillRect(-4, -3, 3, 2); context.fillRect(17, 2, 3, 2);
    }
    if (showSolids && !door.open) {
      context.fillStyle = "#e8494966"; context.fillRect(-8, -8, 32, 16);
    }
    context.restore();
  }
}
