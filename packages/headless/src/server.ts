import { chmodSync } from "node:fs";
import { createServer } from "node:net";
import { stripTypeScriptTypes } from "node:module";
import { format } from "node:util";
import { runInNewContext } from "node:vm";
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { ActRequestSchema, ActResponseSchema, DumpRequestSchema, DumpResponseSchema, EndConversationRequestSchema,
  EndConversationResponseSchema, ExecuteRequestSchema, ExecuteResponseSchema, ExecutionErrorSchema,
  ObserveRequestSchema, ObserveResponseSchema, SayRequestSchema,
  SayResponseSchema } from "../../contracts/src/gen/kingmaker/headless/v1/console_pb.js";
import type { WorldHeadlessGame } from "./world.js";

const MAX_BYTES = 1024 * 1024;
const fault = (id: unknown, code: number, message: string, data?: JsonValue) =>
  ({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });

export type HeadlessMode = "developer" | "qa";

/** Developer mode is trusted code execution. QA mode exposes only observed player actions. */
export function createDispatcher(game: WorldHeadlessGame, mode: HeadlessMode = "developer") {
  async function dispatch(input: unknown): Promise<unknown> {
    if (Array.isArray(input)) {
      if (!input.length) return fault(null, -32600, "Empty batch");
      const replies = [];
      for (const item of input) { const reply = await dispatch(item); if (reply !== undefined) replies.push(reply); }
      return replies.length ? replies : undefined;
    }
    if (!input || typeof input !== "object") return fault(null, -32600, "Invalid request");
    const request = input as Record<string, unknown>;
    const hasId = Object.hasOwn(request, "id"), id = request.id ?? null;
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string"
      || (hasId && id !== null && typeof id !== "string" && !(typeof id === "number" && Number.isFinite(id)))) {
      return fault(null, -32600, "Invalid request");
    }
    const respond = (reply: unknown) => hasId ? reply : undefined;
    if (mode === "qa") {
      if (request.method === "game.observe") {
        try { fromJson(ObserveRequestSchema, (request.params ?? {}) as JsonValue); }
        catch { return respond(fault(id, -32602, "Expected ObserveRequest")); }
        try {
          const activeConversation = game.conversation();
          const result = toJson(ObserveResponseSchema, fromJson(ObserveResponseSchema, {
            observation: game.observe(), actions: game.actions(),
            ...(activeConversation ? { activeConversation } : {}),
          }), { alwaysEmitImplicit: true });
          if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES - 4096) throw new Error("Result too large");
          return respond({ jsonrpc: "2.0", id, result });
        } catch (error) {
          return respond(fault(id, -32000, error instanceof Error ? error.message.slice(0, 2000) : String(error)));
        }
      }
      if (request.method === "game.act") {
        let actionId: string;
        try {
          actionId = fromJson(ActRequestSchema, request.params as JsonValue).id;
          if (!actionId.trim()) throw new Error("id must not be empty");
        } catch { return respond(fault(id, -32602, "Expected ActRequest with non-empty id")); }
        try {
          const value = await game.act(actionId);
          const json = JSON.stringify(value === undefined ? null : value);
          if (json === undefined) throw new Error("Action returned a non-JSON-compatible value");
          if (Buffer.byteLength(json) > MAX_BYTES - 4096) throw new Error("Result too large");
          const result = toJson(ActResponseSchema, fromJson(ActResponseSchema, { value: JSON.parse(json) }),
            { alwaysEmitImplicit: true });
          return respond({ jsonrpc: "2.0", id, result });
        } catch (error) {
          return respond(fault(id, -32000, error instanceof Error ? error.message.slice(0, 2000) : String(error)));
        }
      }
      if (request.method === "game.say") {
        let message: string;
        try {
          message = fromJson(SayRequestSchema, request.params as JsonValue).message;
          if (!message.trim()) throw new Error("message must not be empty");
        } catch { return respond(fault(id, -32602, "Expected SayRequest with non-empty message")); }
        try {
          const result = toJson(SayResponseSchema, fromJson(SayResponseSchema, await game.say(message)),
            { alwaysEmitImplicit: true });
          if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES - 4096) throw new Error("Result too large");
          return respond({ jsonrpc: "2.0", id, result });
        } catch (error) {
          return respond(fault(id, -32000, error instanceof Error ? error.message.slice(0, 2000) : String(error)));
        }
      }
      if (request.method === "game.end_conversation") {
        try { fromJson(EndConversationRequestSchema, (request.params ?? {}) as JsonValue); }
        catch { return respond(fault(id, -32602, "Expected EndConversationRequest")); }
        try {
          await game.endActiveConversation();
          const result = toJson(EndConversationResponseSchema, create(EndConversationResponseSchema),
            { alwaysEmitImplicit: true });
          return respond({ jsonrpc: "2.0", id, result });
        } catch (error) {
          return respond(fault(id, -32000, error instanceof Error ? error.message.slice(0, 2000) : String(error)));
        }
      }
      if (request.method === "game.dump") {
        let description: string, filepath: string;
        try {
          ({ description, filepath } = fromJson(DumpRequestSchema, request.params as JsonValue));
          if (!description.trim() || !filepath.trim()) throw new Error("description and filepath must not be empty");
        } catch { return respond(fault(id, -32602, "Expected DumpRequest with non-empty description and filepath")); }
        try {
          game.dump(filepath, description);
          const result = toJson(DumpResponseSchema, create(DumpResponseSchema), { alwaysEmitImplicit: true });
          return respond({ jsonrpc: "2.0", id, result });
        } catch (error) {
          return respond(fault(id, -32000, error instanceof Error ? error.message.slice(0, 2000) : String(error)));
        }
      }
      return respond(fault(id, -32601, "Method not found"));
    }
    if (request.method !== "game.execute") return respond(fault(id, -32601, "Method not found"));
    let code: string;
    try {
      code = fromJson(ExecuteRequestSchema, request.params as JsonValue).code;
      if (!code.trim()) throw new Error("code must not be empty");
    } catch { return respond(fault(id, -32602, "Expected ExecuteRequest with non-empty code")); }
    const logs: string[] = [];
    let logBytes = 0;
    const log = (...args: unknown[]) => {
      const line = format(...args), size = Buffer.byteLength(line);
      if (logBytes + size > MAX_BYTES / 2) throw new Error("Console output limit exceeded");
      logBytes += size; logs.push(line);
    };
    try {
      const source = stripTypeScriptTypes(`(async function () {\n"use strict";\n${code}\n})`, { mode: "strip" });
      const execute = runInNewContext(source, { game, console: { log, info: log, warn: log, error: log, debug: log },
        setTimeout, clearTimeout }, { filename: "headless-snippet.ts" }) as () => Promise<unknown>;
      const value = await execute();
      const json = JSON.stringify(value === undefined ? null : value);
      if (json === undefined) throw new Error("Return a JSON-compatible value");
      if (Buffer.byteLength(json) + logBytes > MAX_BYTES - 4096) throw new Error("Result too large; select a smaller part of the world");
      const result = toJson(ExecuteResponseSchema, fromJson(ExecuteResponseSchema, { value: JSON.parse(json), logs }),
        { alwaysEmitImplicit: true });
      return respond({ jsonrpc: "2.0", id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error && typeof error === "object" && "stack" in error ? String(error.stack) : "";
      return respond(fault(id, -32000, message.slice(0, 2000),
        toJson(ExecutionErrorSchema, create(ExecutionErrorSchema, { logs, stack: stack.slice(0, 8000) }))));
    }
  }
  return dispatch;
}

/** Newline-delimited JSON-RPC; one global queue serializes every client's code. */
export async function startConsole(game: WorldHeadlessGame, socketPath: string, mode: HeadlessMode = "developer") {
  const dispatch = createDispatcher(game, mode);
  let queue = Promise.resolve();
  const server = createServer(socket => {
    socket.setEncoding("utf8");
    let buffer = "", pending = 0;
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_BYTES || ++pending > 32) { socket.destroy(); return; }
        queue = queue.then(async () => {
          try {
            let input: unknown;
            try { input = JSON.parse(line); }
            catch { socket.write(JSON.stringify(fault(null, -32700, "Parse error")) + "\n"); return; }
            const reply = await dispatch(input);
            if (reply !== undefined && !socket.destroyed) socket.write(JSON.stringify(reply) + "\n");
          } finally { pending--; }
        }).catch(() => { socket.destroy(); });
      }
      if (Buffer.byteLength(buffer) > MAX_BYTES) socket.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      try { chmodSync(socketPath, 0o600); server.removeListener("error", reject); resolve(); }
      catch (error) { server.close(); reject(error); }
    });
  });
  return server;
}
