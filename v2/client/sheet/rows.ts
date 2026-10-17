import type { Pockets, SheetData } from "../../shared/rules/types.ts";
import { jsonOf } from "../json.ts";
import type { Sheet } from "../module_bindings/types.ts";

/**
 * The character sheet from its row (v1-design §3.6): `data`, the sheet the rules engine made (all
 * but the purse and what else they carry), with `pockets`, which the world keeps up to date without
 * the engine, laid over it. What the created screen, the sheet over a scene and `play sheet` show.
 */

export type SheetRow = Pick<Sheet, "data" | "pockets">;

/** The sheet as the screens draw it; undefined while the engine hasn't made one (data is empty, or won't read). */
export function sheetOf(row: SheetRow | undefined): SheetData | undefined {
  const data = jsonOf<Omit<SheetData, "purse" | "carrying"> & Partial<Pockets>>(row?.data);
  if (!data || typeof data !== "object") return undefined;
  const pockets = jsonOf<Partial<Pockets>>(row?.pockets);
  return { ...data, purse: pockets?.purse ?? data.purse ?? [], carrying: pockets?.carrying ?? data.carrying ?? [] };
}
