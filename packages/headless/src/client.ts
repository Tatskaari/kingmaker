import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { create, fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import { ExecuteRequestSchema, ExecuteResponseSchema } from "../../contracts/src/gen/kingmaker/headless/v1/console_pb.js";

/** Each call may reconnect: the world belongs to the server, not the connection. */
export function execute(socketPath: string, code: string): Promise<{ value: JsonValue; logs: string[] }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath), id = randomUUID();
    let buffer = "", received = false;
    socket.setEncoding("utf8");
    socket.on("error", reject);
    socket.on("close", () => { if (!received) reject(new Error("Game console disconnected before replying; execution may have occurred.")); });
    socket.on("connect", () => socket.write(JSON.stringify({ jsonrpc: "2.0", id, method: "game.execute",
      params: toJson(ExecuteRequestSchema, create(ExecuteRequestSchema, { code })) }) + "\n"));
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
        const response = fromJson(ExecuteResponseSchema, reply.result);
        const json = toJson(ExecuteResponseSchema, response) as { value?: JsonValue };
        resolve({ value: json.value ?? null, logs: response.logs });
      } catch (error) { reject(error); }
      finally { socket.end(); }
    });
  });
}
