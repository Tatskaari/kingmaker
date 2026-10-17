import { Identity } from "spacetimedb";

/**
 * The page host's randomness (browser-design §5), from crypto.getRandomValues alone: never
 * crypto.randomUUID, which a page served without a secure context doesn't have. Each start's dice
 * seed and the game's uuids (the memory host's own come from a fixed sequence, which would repeat
 * after a reload), and the identities the host mints: its database's own, and each session's.
 */

/** A dice seed for the simulation's run: a u32. */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** A version 4 uuid, as tx.uuid() gives one. */
export function randomUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = hexOf(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** An identity nobody has had: 32 random bytes, as SpacetimeDB's are long. */
export function randomIdentity(): Identity {
  return new Identity(BigInt(`0x${hexOf(crypto.getRandomValues(new Uint8Array(32)))}`));
}

const hexOf = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
