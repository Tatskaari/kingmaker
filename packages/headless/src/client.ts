import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { ActRequestSchema, ActResponseSchema, ExecuteRequestSchema, ExecuteResponseSchema,
  ObserveRequestSchema, ObserveResponseSchema } from "../../contracts/src/gen/kingmaker/headless/v1/console_pb.js";

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
}> }> {
  return request(socketPath, "game.observe", toJson(ObserveRequestSchema, create(ObserveRequestSchema)))
    .then(result => toJson(ObserveResponseSchema, fromJson(ObserveResponseSchema, result),
      { alwaysEmitImplicit: true }) as { observation: string; actions: Array<{
        id: string; description: string; type: string; legality: string;
      }> });
}

export function act(socketPath: string, id: string): Promise<{ value: JsonValue }> {
  return request(socketPath, "game.act", toJson(ActRequestSchema, create(ActRequestSchema, { id })))
    .then(result => {
      const response = fromJson(ActResponseSchema, result);
      const json = toJson(ActResponseSchema, response) as { value?: JsonValue };
      return { value: json.value ?? null };
    });
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
