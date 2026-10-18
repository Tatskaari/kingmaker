// The prototype's src/game/town.ts:524-540 at 44c6d4a (town.observe) and src/cli/qa.ts:88-97 (print, options), from the explore view: the whereabouts, the town drawn plain at 80x24 (townText), look() as the player would hear it, who's further off, where the story is heading, Recently (the explore row's log), the action menu's text (menuText, town-design §3.9) and ACTIONS (town.actions, with the menu's acts: :567-583); a spectator's map lists no actions (they're the lead's).
import { look, whereabouts } from "../../shared/map/explore.ts";
import { actions, leadTarget, leadWords, targets, where, type Action } from "../../shared/map/town.ts";
import { asHeard } from "../../shared/scene/names.ts";
import { townText } from "../map/views.ts";
import type { ExploreView } from "./rows.ts";
import { menuActions, menuCtx, SHARED_TOWN, type TownMenu } from "./town.ts";

/** The map as the QA console printed it (MODE: explore), for the headless client: what the player would see and do from here. `town`: the action menu's checks (a test's fixture, or the shared ones). */
export function exploreText(view: ExploreView, town: TownMenu = SHARED_TOWN): string {
  const ex = view.ex;
  const w = whereabouts(ex);
  // Further off than look() goes: who's about (everything else is in the actions).
  const near = targets(ex, view.unheard).filter(t => t.distance > 3 && t.actor && (t.actor.kind === "person" || t.actor.kind === "creature"));
  const lead = leadTarget(ex);
  const menu = view.watching || ex.scene ? undefined : menuOf(view, town);
  const text = [
    `${w.map}: ${w.place}, ${w.time.replace("-", " ")}. You are the @; on this map north is up-left and east is up-right.`,
    townText(ex, undefined, { w: 80, h: 24 }),
    asHeard(look(ex), view.unheard),
    ...(near.length ? [`Further off: ${near.slice(0, 10).map(t => `${t.actor!.name} (${where(t.distance, t.direction)})`).join(", ")}.`] : []),
    ...(lead && view.lead ? [`The story is heading for ${view.lead.title}: ${leadWords(lead, ex.at)}.`] : []),
    ...(view.log.length ? [`Recently: ${view.log.slice(-3).join(" ")}`] : []),
    ...(view.watching ? [`(You're watching: ${view.watching} has the lead.)`] : []),
    ...(menu?.text ? [menu.text] : []),
  ].join("\n\n");
  const map = view.watching ? [] : actions(ex, view.unheard);
  const offered = [...map, ...(menu?.acts ?? []).filter(a => !map.some(m => m.id === a.id))];
  return `MODE: explore\n\n${text}${offered.length ? `\n\nACTIONS:\n${offered.map(a => `- ${a.id}: ${a.label}`).join("\n")}` : ""}`;
}

/** The action menu as observe says it, and its acts for ACTIONS; what went wrong in it, in its place. */
function menuOf(view: ExploreView, town: TownMenu): { text: string; acts: Action[] } {
  const c = menuCtx(view);
  try {
    return { text: town.text(c), acts: menuActions(town, c) };
  } catch (error) {
    return { text: `(The action menu went wrong: ${error instanceof Error ? error.message : String(error)}.)`, acts: [] };
  }
}
