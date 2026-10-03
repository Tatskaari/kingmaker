/** Decode SSE data events across arbitrary network and UTF-8 boundaries. */
export async function* serverSentData(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body) throw new Error("Missing stream body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", data: string[] = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      while (true) {
        const end = buffer.search(/[\r\n]/);
        if (end < 0 || (!done && end === buffer.length - 1 && buffer[end] === "\r")) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + (buffer.slice(end, end + 2) === "\r\n" ? 2 : 1));
        if (!line) {
          if (data.length) yield data.join("\n");
          data = [];
        } else if (line === "data" || line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      // SSE dispatches only blank-line-terminated events; discard an incomplete tail.
      if (done) return;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
