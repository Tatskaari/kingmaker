import type { TileLayer, Tileset, WorldMap } from "../../../packages/contracts/src/index.js";

export interface MapHit {
  tileX: number;
  tileY: number;
  roomName: string | undefined;
  layer: TileLayer | undefined;
}

export class CanvasMapRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #context: CanvasRenderingContext2D;
  readonly #map: WorldMap;
  readonly #images = new Map<string, HTMLImageElement>();

  constructor(canvas: HTMLCanvasElement, map: WorldMap) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D rendering is unavailable");
    this.#canvas = canvas;
    this.#context = context;
    this.#map = map;
    canvas.width = map.width * map.tileWidth;
    canvas.height = map.height * map.tileHeight;
    context.imageSmoothingEnabled = false;
  }

  async load(): Promise<void> {
    await Promise.all(this.#map.tilesets.map(tileset => new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => {
        this.#images.set(tileset.id, image);
        resolve();
      }, { once: true });
      image.addEventListener("error", () => reject(new Error(`Could not load ${tileset.imagePath}`)), { once: true });
      image.src = tileset.imagePath;
    })));
  }

  render(showRooms = true, showSolids = false): void {
    const context = this.#context;
    context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    context.fillStyle = "#090807";
    context.fillRect(0, 0, this.#canvas.width, this.#canvas.height);

    this.#map.tiles.forEach((tile, index) => {
      const tileX = index % this.#map.width;
      const tileY = Math.floor(index / this.#map.width);
      for (const layer of tile.layers) this.#drawLayer(layer, tileX, tileY);
    });

    if (showRooms) this.#drawRooms();
    if (showSolids) this.#drawSolids();
  }

  hit(clientX: number, clientY: number): MapHit | undefined {
    const rect = this.#canvas.getBoundingClientRect();
    const worldX = (clientX - rect.left) * this.#canvas.width / rect.width;
    const worldY = (clientY - rect.top) * this.#canvas.height / rect.height;
    const tileX = Math.floor(worldX / this.#map.tileWidth);
    const tileY = Math.floor(worldY / this.#map.tileHeight);
    if (tileX < 0 || tileY < 0 || tileX >= this.#map.width || tileY >= this.#map.height) return undefined;

    const localX = worldX - tileX * this.#map.tileWidth;
    const localY = worldY - tileY * this.#map.tileHeight;
    const tile = this.#map.tiles[tileY * this.#map.width + tileX];
    const layer = tile?.layers.findLast(candidate => {
      const bounds = candidate.bounds;
      return bounds && localX >= bounds.x && localY >= bounds.y
        && localX < bounds.x + bounds.width && localY < bounds.y + bounds.height;
    });
    return { tileX, tileY, roomName: this.#roomAt(tileX, tileY), layer };
  }

  #drawLayer(layer: TileLayer, tileX: number, tileY: number): void {
    const tileset = this.#map.tilesets.find(candidate => candidate.id === layer.tilesetId);
    const image = this.#images.get(layer.tilesetId);
    if (!tileset || !image || !layer.bounds) return;
    const sourceX = (layer.tileId % tileset.columns) * tileset.tileWidth;
    const sourceY = Math.floor(layer.tileId / tileset.columns) * tileset.tileHeight;
    this.#context.drawImage(
      image,
      sourceX,
      sourceY,
      tileset.tileWidth,
      tileset.tileHeight,
      tileX * this.#map.tileWidth + layer.bounds.x,
      tileY * this.#map.tileHeight + layer.bounds.y,
      layer.bounds.width,
      layer.bounds.height,
    );
  }

  #drawRooms(): void {
    this.#context.font = "5px ui-monospace, monospace";
    this.#context.textAlign = "center";
    this.#context.textBaseline = "middle";
    for (const room of this.#map.rooms) {
      for (const region of room.regions) {
        const x = region.x * this.#map.tileWidth;
        const y = region.y * this.#map.tileHeight;
        const width = region.width * this.#map.tileWidth;
        const height = region.height * this.#map.tileHeight;
        this.#context.fillStyle = "#d8b56816";
        this.#context.fillRect(x, y, width, height);
        this.#context.strokeStyle = "#efd18d88";
        this.#context.lineWidth = 0.5;
        this.#context.strokeRect(x + 0.25, y + 0.25, width - 0.5, height - 0.5);
      }
      const labelRegion = room.regions.reduce((largest, region) =>
        region.width * region.height > largest.width * largest.height ? region : largest,
      );
      const x = labelRegion.x * this.#map.tileWidth;
      const y = labelRegion.y * this.#map.tileHeight;
      const width = labelRegion.width * this.#map.tileWidth;
      const height = labelRegion.height * this.#map.tileHeight;
      this.#context.fillStyle = "#fff0c9";
      this.#context.fillText(room.name, x + width / 2, y + height / 2, Math.max(0, width - 8));
    }
  }

  #drawSolids(): void {
    this.#map.tiles.forEach((tile, index) => {
      const tileX = index % this.#map.width;
      const tileY = Math.floor(index / this.#map.width);
      for (const layer of tile.layers.filter(candidate => candidate.solid && candidate.bounds)) {
        const bounds = layer.bounds!;
        this.#context.fillStyle = "#e8494966";
        this.#context.fillRect(
          tileX * this.#map.tileWidth + bounds.x,
          tileY * this.#map.tileHeight + bounds.y,
          bounds.width,
          bounds.height,
        );
      }
    });
  }

  #roomAt(tileX: number, tileY: number): string | undefined {
    return this.#map.rooms.find(room => room.regions.some(region =>
      tileX >= region.x && tileY >= region.y
      && tileX < region.x + region.width && tileY < region.y + region.height,
    ))?.name;
  }
}
