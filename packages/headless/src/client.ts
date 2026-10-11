import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { ActRequestSchema, ActResponseSchema, DumpRequestSchema, DumpResponseSchema, EndConversationRequestSchema,
  EndConversationResponseSchema, ExecuteRequestSchema, ExecuteResponseSchema, ObserveRequestSchema,
  ObserveResponseSchema, SayRequestSchema,
  SayResponseSchema } from "../../contracts/src/gen/kingmaker/headless/v1/console_pb.js";

/** Each call may reconnect: the world belongs to the server, not the connection. */
export function execute(socketPath: string, code: string): Promise<{ value: JsonValue; logs: string[] }> {
  return request(socketPath, "game.execute", toJson(ExecuteRequestSchema, create(ExecuteRequestSchema, { code })))
    .then(result => {
      const response = fromJson(ExecuteResponseSchema, result);
      const json = toJson(ExecuteResponseSchema, response) as { value?: JsonValue };
      return { value: json.value ?? null, logs: response.logs };
    });
}

export function observe(socketPath: string): Promise<{ observation: string; actions: Array<{
  id: string; description: string; type: string; legality: string;
}>; activeConversation?: { characterId: string } }> {
  return request(socketPath, "game.observe", toJson(ObserveRequestSchema, create(ObserveRequestSchema)))
    .then(result => toJson(ObserveResponseSchema, fromJson(ObserveResponseSchema, result),
      { alwaysEmitImplicit: true }) as { observation: string; actions: Array<{
        id: string; description: string; type: string; legality: string;
      }>; activeConversation?: { characterId: string } });
}

export function act(socketPath: string, id: string): Promise<{ value: JsonValue }> {
  return request(socketPath, "game.act", toJson(ActRequestSchema, create(ActRequestSchema, { id })))
    .then(result => {
      const response = fromJson(ActResponseSchema, result);
      const json = toJson(ActResponseSchema, response) as { value?: JsonValue };
      return { value: json.value ?? null };
    });
}

export function say(socketPath: string, message: string): Promise<{ characterId: string; reply: string }> {
  return request(socketPath, "game.say", toJson(SayRequestSchema, create(SayRequestSchema, { message })))
    .then(result => toJson(SayResponseSchema, fromJson(SayResponseSchema, result),
      { alwaysEmitImplicit: true }) as { characterId: string; reply: string });
}

export function endConversation(socketPath: string): Promise<void> {
  return request(socketPath, "game.end_conversation",
    toJson(EndConversationRequestSchema, create(EndConversationRequestSchema)))
    .then(result => { fromJson(EndConversationResponseSchema, result); });
}

export function dump(socketPath: string, description: string, filepath: string): Promise<void> {
  return request(socketPath, "game.dump", toJson(DumpRequestSchema, create(DumpRequestSchema, { description, filepath })))
    .then(result => { fromJson(DumpResponseSchema, result); });
}

function request(socketPath: string, method: string, params: JsonValue): Promise<JsonValue> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath), id = randomUUID();
    let buffer = "", received = false;
    socket.setEncoding("utf8");
    socket.on("error", reject);
    socket.on("close", () => { if (!received) reject(new Error("Game console disconnected before replying; execution may have occurred.")); });
    socket.on("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"));
    socket.on("data", chunk => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      received = true;
      try {
        const reply = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
        if (reply.jsonrpc !== "2.0" || reply.id !== id) throw new Error("Unexpected JSON-RPC response");
        if (reply.error) {
          const error = new Error(reply.error.message);
          Object.assign(error, { code: reply.error.code, data: reply.error.data });
          throw error;
        }
        resolve(reply.result as JsonValue);
      } catch (error) { reject(error); }
      finally { socket.end(); }
    });
  });
}
