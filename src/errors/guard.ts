import { stripQuery } from "../core/scrub.js";
import type { Client } from "../core/types.js";

/** Errors the `guard` snippet caught before the SDK loaded (`window.__trapp.buffer`). */
export function drainGuardBuffer(client: Client) {
  const buffer = window.__trapp?.buffer;
  if (!Array.isArray(buffer)) return;
  for (const entry of buffer.splice(0, 50)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "resource") {
      client.emit("capture", {
        error: null,
        message: `Failed to load ${stripQuery(String(entry.url ?? ""))}`,
        context: { mechanism: "guard", level: "warning", type: "ResourceError" },
      });
      continue;
    }
    const error = new Error(String(entry.message ?? "Unknown error"));
    if (typeof entry.stack === "string") error.stack = entry.stack;
    client.emit("capture", { error, context: { mechanism: "guard" } });
  }
}
