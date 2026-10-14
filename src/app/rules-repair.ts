import type { SessionState } from "../runtime/session.ts";

/**
 * A stop-gap for a rules-layer bug, kept here until src/rules/dnd.ts handles it (see the report):
 * the engine's castSpell planner logs a spell attack (Fire Bolt, Scorching Ray...) with the spell's
 * id as `weaponInstanceId`, which the engine's own event schema rejects when the campaign is loaded
 * again ("Expected a ULID"). From then on every rules call on the session fails: the sheet, rests,
 * level-ups, the fight. Those events are a log of the roll (the damage is its own event), so the
 * spell id can stand aside for a placeholder id.
 */

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const PLACEHOLDER = "0".repeat(26);

/** Repair the session's rules campaign in place; true when something needed it. */
export function repairCampaign(session: SessionState): boolean {
  if (!session.rules?.campaign) return false;
  let campaign: { events?: Array<Record<string, unknown>> };
  try { campaign = JSON.parse(session.rules.campaign); } catch { return false; }
  let fixed = false;
  for (const e of campaign.events ?? []) {
    if (typeof e["weaponInstanceId"] === "string" && !ULID.test(e["weaponInstanceId"])) {
      e["weaponInstanceId"] = PLACEHOLDER;
      fixed = true;
    }
  }
  if (fixed) session.rules.campaign = JSON.stringify(campaign);
  return fixed;
}
