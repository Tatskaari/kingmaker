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

  /** A room-coloured, labelled ownership view, usable in any browser. */
  svg(): string {
    const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    const shapes = this.rooms.map((room, index) => {
      const colour = `hsl(${index * 137.5 % 360} 45% 65%)`;
      return room.regions.map(r => `<rect x="${r.x * 16}" y="${r.y * 16}" width="${r.width * 16}" height="${r.height * 16}" fill="${colour}"><title>${escape(room.name)} — ${escape(room.residents?.join(', ') || 'Public')}</title></rect>`).join('')
        + `<text x="${room.regions[0]!.x * 16 + 3}" y="${room.regions[0]!.y * 16 + 12}" font-size="9">${escape(room.name)}</text>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.width * 16} ${this.height * 16}"><rect width="100%" height="100%" fill="#161b22"/>${shapes}</svg>`;
  }
}
