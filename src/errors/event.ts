import { hex, truncate } from "../core/env.js";
import { pageUrl, scrub } from "../core/scrub.js";
import type { Breadcrumb, CaptureContext, Client, Level } from "../core/types.js";
import { MAX_BREADCRUMBS } from "./breadcrumbs.js";
import { MAX_FRAMES, parseStack, type Frame } from "./stack.js";

/** One entry of `ErrorBatch.errors` (back/src/model.rs `ErrorIn`). */
export interface ErrorEvent {
  id: string;
  timestamp: string;
  level: Level;
  type: string;
  message: string;
  frames: Frame[];
  breadcrumbs: Breadcrumb[];
  url: string;
  userId?: string;
  tags: Record<string, string>;
  count: number;
}

export const MESSAGE_MAX = 2000;
export const EVENT_MAX_BYTES = 64 * 1024;
const MAX_TAGS = 30;

function nameOf(error: unknown, context: CaptureContext): string {
  if (context.type) return context.type;
  if (error instanceof Error) return error.name || "Error";
  if (error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string") {
    return (error as { name: string }).name;
  }
  return "Error";
}

function messageOf(error: unknown, fallback: string | undefined): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (fallback) return fallback;
  if (error && typeof error === "object") {
    const m = (error as { message?: unknown }).message;
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(error);
    } catch {
      /* fall through */
    }
  }
  return String(error);
}

/** Byte length of the serialized event (what the server will count). */
export function sizeOf(event: ErrorEvent): number {
  const json = JSON.stringify(event);
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(json).length : json.length;
}

/** Applies every limit from the plan: message 2 000 chars, 100 frames, 50 crumbs, 30 tags, 64 KB. */
export function buildEvent(
  client: Client,
  error: unknown,
  message: string | undefined,
  context: CaptureContext,
  breadcrumbs: Breadcrumb[],
): ErrorEvent {
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...client.tags, ...context.tags }).slice(0, MAX_TAGS)) {
    tags[truncate(k, 64)] = truncate(scrub(String(v)), 200);
  }
  if (context.mechanism) tags.mechanism = context.mechanism;

  const event: ErrorEvent = {
    id: hex(16),
    timestamp: new Date().toISOString(),
    level: context.level ?? "error",
    type: truncate(nameOf(error, context), 100),
    message: truncate(scrub(messageOf(error, message)), MESSAGE_MAX),
    frames: parseStack(error instanceof Error ? error.stack : undefined).slice(0, MAX_FRAMES),
    breadcrumbs: breadcrumbs.slice(-MAX_BREADCRUMBS),
    url: pageUrl(),
    tags,
    count: 1,
  };
  if (client.user) event.userId = client.user.id;

  // Shrink oversized events: breadcrumbs first, then frames, then the message.
  while (sizeOf(event) > EVENT_MAX_BYTES) {
    if (event.breadcrumbs.length) event.breadcrumbs = event.breadcrumbs.slice(Math.ceil(event.breadcrumbs.length / 2));
    else if (event.frames.length > 10) event.frames = event.frames.slice(0, Math.floor(event.frames.length / 2));
    else if (event.message.length > 200) event.message = truncate(event.message, Math.floor(event.message.length / 2));
    else break;
  }
  return event;
}

/** Same error within the dedupe window: type, message and the innermost frame. */
export function fingerprint(event: ErrorEvent): string {
  const top = event.frames[0];
  return `${event.type}|${event.message}|${top ? `${top.filename}:${top.lineno}:${top.colno}` : ""}`;
}
