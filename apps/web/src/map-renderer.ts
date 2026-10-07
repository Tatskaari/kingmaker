import type { TileLayer, WorldMap } from "../../../packages/contracts/src/index.js";

export interface MapHit {
  tileX: number;
  tileY: number;
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
    canvas.width = map.width * map.tileWidth * 2;
    canvas.height = map.height * map.tileHeight * 2;
    // Keep game coordinates intact while drawing the illustrated atlas at 2× resolution.
    context.scale(2, 2);
    context.imageSmoothingEnabled = true;
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

  render(): void {
    const context = this.#context;
    context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    context.fillStyle = "#090807";
    context.fillRect(0, 0, this.#canvas.width, this.#canvas.height);

    this.#map.tiles.forEach((tile, index) => {
      const tileX = index % this.#map.width;
      const tileY = Math.floor(index / this.#map.width);
      for (const layer of tile.layers) this.#drawLayer(layer, tileX, tileY);
    });

  }

  drawSprite(tilesetId: string, tileId: number, x: number, y: number): void {
    const tileset = this.#map.tilesets.find(candidate => candidate.id === tilesetId);
    const image = this.#images.get(tilesetId);
    if (!tileset || !image) return;
    const width = image.naturalWidth / tileset.columns;
    const height = image.naturalHeight / Math.ceil(tileset.tileCount / tileset.columns);
    this.#context.drawImage(image, tileId % tileset.columns * width,
      Math.floor(tileId / tileset.columns) * height, width, height,
      x * this.#map.tileWidth, y * this.#map.tileHeight, this.#map.tileWidth, this.#map.tileHeight);
  }

  hit(clientX: number, clientY: number): MapHit | undefined {
    const rect = this.#canvas.getBoundingClientRect();
    const worldX = (clientX - rect.left) * this.#map.width * this.#map.tileWidth / rect.width;
    const worldY = (clientY - rect.top) * this.#map.height * this.#map.tileHeight / rect.height;
    const tileX = Math.floor(worldX / this.#map.tileWidth);
    const tileY = Math.floor(worldY / this.#map.tileHeight);
    if (tileX < 0 || tileY < 0 || tileX >= this.#map.width || tileY >= this.#map.height) return undefined;

    return { tileX, tileY };
  }

  #drawLayer(layer: TileLayer, tileX: number, tileY: number): void {
    const tileset = this.#map.tilesets.find(candidate => candidate.id === layer.tilesetId);
    const image = this.#images.get(layer.tilesetId);
    if (!tileset || !image || !layer.bounds) return;
    // The illustration can have a different pixel density from the logical atlas.
    const width = image.naturalWidth / tileset.columns;
    const height = image.naturalHeight / Math.ceil(tileset.tileCount / tileset.columns);
    const sourceX = (layer.tileId % tileset.columns) * width;
    const sourceY = Math.floor(layer.tileId / tileset.columns) * height;
    this.#context.drawImage(
      image,
      sourceX,
      sourceY,
      width,
      height,
      tileX * this.#map.tileWidth + layer.bounds.x,
      tileY * this.#map.tileHeight + layer.bounds.y,
      layer.bounds.width,
      layer.bounds.height,
    );
  }

}
