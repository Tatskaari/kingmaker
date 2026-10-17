import type { Identity } from "spacetimedb";
import { refusal } from "../../shared/protocol/refusals.ts";
import { Refused, type Env, type TxCtx } from "./context.ts";

/**
 * The two callers a few reducers allow (v0-design §3.3, §3.6): the AI service, by the identity the
 * owner set in AI_IDENTITY at publish (stream_reply, service_ping), and the database's owner, whom
 * init records (install_campaign, ping_ai).
 */

/** Is this the AI service? Nobody is while AI_IDENTITY is unset. */
export function isService(env: Env, sender: Identity): boolean {
  return !!env.AI_IDENTITY && hex(env.AI_IDENTITY) === hex(sender.toHexString());
}

/** Is this the database's owner? */
export function isAdmin(tx: TxCtx, sender: Identity): boolean {
  return !!tx.db.admin.identity.find(sender);
}

/** service_ping: the AI service proving its token reaches the module as itself. It writes nothing. */
export function servicePing(tx: TxCtx, sender: Identity): void {
  if (!isService(tx.env, sender)) throw new Refused(refusal("not_service"));
}

/** Identities as hex, however they're written ("0x…", capitals). */
const hex = (id: string) => id.toLowerCase().replace(/^0x/, "");
