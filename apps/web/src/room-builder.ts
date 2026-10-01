export interface PreviewFixture {
  name: string; sprite: number; position?: { x: number; y: number };
  inventory?: { items: { name: string }[] };
}
export interface PreviewDoor {
  id: string; name: string; open: boolean; roomIds: string[];
  tiles: { x: number; y: number }[]; interactionSpots: { x: number; y: number }[];
}
export interface Region { x: number; y: number; width: number; height: number }
export interface AuthoredRoom {
  id: string; name: string; regions: Region[];
  /** An empty list means public; a nonempty list grants private access. */
  residents?: string[];
}

/** Claims each floor tile exactly once. Corridors use the same ownership rules
 * as chambers, so accidentally extending one into another room is an error. */
export class RoomBuilder {
  readonly rooms: AuthoredRoom[] = [];
  readonly owners = new Map<string, string>();
  constructor(readonly width: number, readonly height: number) {}

  room(room: AuthoredRoom): void {
    if (this.rooms.some(existing => existing.id === room.id)) throw new Error(`Duplicate room: ${room.id}`);
    const claims = new Set<string>();
    for (const region of room.regions) {
      if (![region.x, region.y, region.width, region.height].every(Number.isInteger)
        || region.width < 1 || region.height < 1 || region.x < 0 || region.y < 0
        || region.x + region.width > this.width || region.y + region.height > this.height) {
        throw new Error(`Invalid region in ${room.id}`);
      }
      for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
        const key = `${x},${y}`, owner = this.owners.get(key);
        if (owner && owner !== room.id) throw new Error(`${room.id} overlaps ${owner} at ${key}`);
        claims.add(key);
      }
    }
    if (!claims.size) throw new Error(`Empty room: ${room.id}`);
    for (const key of claims) this.owners.set(key, room.id);
    this.rooms.push(room);
  }

  /** Derive reciprocal exits from actual shared floor edges, never hand-written links. */
  worldRooms() {
    return this.rooms.map(room => {
      const exits = new Set<string>();
      for (const [key, owner] of this.owners) {
        if (owner !== room.id) continue;
        const [x, y] = key.split(",").map(Number) as [number, number];
        for (const neighbour of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
          const other = this.owners.get(neighbour);
          if (other && other !== owner) exits.add(other);
        }
      }
      return { id: room.id, name: room.name, private: !!room.residents?.length,
        allowedCharacterIds: room.residents ?? [], exitRoomIds: [...exits].sort() };
    });
  }

  /** Closed doors must not strand floor tiles under another room's ownership. */
  validateDoorBoundaries(doors: readonly PreviewDoor[]): void {
    const blocked = new Set(doors.flatMap(door => door.tiles.map(p => `${p.x},${p.y}`)));
    for (const door of doors) for (const [side, point] of door.interactionSpots.entries()) {
      const owner = this.owners.get(`${point.x},${point.y}`);
      if (owner !== door.roomIds[side]) throw new Error(`${door.id} approach ${side}: expected ${door.roomIds[side]}, found ${owner}`);
    }
    for (const room of this.rooms) {
      const floor = new Set([...this.owners].filter(([key, owner]) => owner === room.id && !blocked.has(key)).map(([key]) => key));
      const pending = [floor.values().next().value!];
      const reached = new Set<string>();
      while (pending.length) {
        const key = pending.pop()!;
        if (!floor.has(key) || reached.has(key)) continue;
        reached.add(key);
        const [x, y] = key.split(",").map(Number) as [number, number];
        pending.push(`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`);
      }
      if (reached.size !== floor.size) throw new Error(`${room.id} has stranded tiles behind closed doors`);
    }
  }

  /** A room-coloured, labelled ownership view, usable in any browser. */
  svg(doors: readonly PreviewDoor[] = [], fixtures: readonly PreviewFixture[] = [], atlas = ""): string {
    const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    const shapes = this.rooms.map((room, index) => {
      const colour = `hsl(${index * 137.5 % 360} 45% 65%)`;
      return room.regions.map(r => `<rect x="${r.x * 16}" y="${r.y * 16}" width="${r.width * 16}" height="${r.height * 16}" fill="${colour}"><title>${escape(room.name)} — ${escape(room.residents?.join(', ') || 'Public')}</title></rect>`).join('')
        + `<text x="${room.regions[0]!.x * 16 + 3}" y="${room.regions[0]!.y * 16 + 12}" font-size="9">${escape(room.name)}</text>`;
    }).join('');
    const furniture = fixtures.map(f => {
      if (!f.position) return "";
      const title = `${escape(f.name)}${f.inventory?.items.length ? ": " + f.inventory.items.map(item => escape(item.name)).join(", ") : ""}`;
      return `<g><title>${title}</title><svg x="${f.position.x * 16}" y="${f.position.y * 16}" width="16" height="16" viewBox="${f.sprite % 12 * 16} ${Math.floor(f.sprite / 12) * 16} 16 16"><use href="#furniture-atlas"/></svg></g>`;
    }).join("");
    const overlays = doors.map(door => {
      const colour = door.open ? "#ffcc33" : "#ef4444";
      return door.tiles.map(p => `<rect x="${p.x * 16 + 1}" y="${p.y * 16 + 1}" width="14" height="14" fill="${colour}" fill-opacity=".55" stroke="#111" stroke-width="2"><title>${escape(door.name)} (${door.open ? "open" : "closed"}) — ${p.x},${p.y}</title></rect>`).join("")
        + door.interactionSpots.map((p, side) => `<circle cx="${p.x * 16 + 8}" cy="${p.y * 16 + 8}" r="3" fill="white" stroke="#111"><title>${escape(door.name)} approach: ${escape(door.roomIds[side] ?? "")} — owned by ${escape(this.owners.get(`${p.x},${p.y}`) ?? "none")}</title></circle>`).join("");
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width * 16} ${this.height * 16}"><defs><image id="furniture-atlas" href="${atlas}" width="192" height="176"/></defs><rect width="100%" height="100%" fill="#161b22"/>${shapes}${furniture}${overlays}<text x="16" y="${this.height * 16 - 16}" fill="white" font-size="12">Door tiles: red = closed; gold = open. White dots = interaction spots. Colours = room ownership.</text></svg>`;
  }
}
