import type { Dsn } from "./dsn.js";
import { safe } from "./env.js";

/** Longest pause a `Retry-After` may impose. */
const MAX_RETRY_MS = 3_600_000;
/** `keepalive` requests are capped by browsers at 64 KB in flight. */
const KEEPALIVE_MAX = 60_000;
const TEXT = "text/plain;charset=UTF-8";

export interface SendOptions {
  /** Extra query parameters besides `key`. */
  query?: Record<string, string | number>;
  /** Use `navigator.sendBeacon` (page is unloading). */
  beacon?: boolean;
}

export interface Flushable {
  flush(unloading?: boolean): void;
}

export interface Transport {
  url(path: string, query?: Record<string, string | number>): string;
  /**
   * POSTs a JSON string, or bytes already gzipped (see `compress` in batch.ts).
   * Resolves with the HTTP status; 0 when the request failed or went out as a beacon.
   */
  send(path: string, body: string | Uint8Array, options?: SendOptions): Promise<number>;
  /** True while a `Retry-After` pause is in effect for this path. */
  paused(path: string): boolean;
  /** Batchers register here so `flush()` and `pagehide` reach them. */
  readonly queues: Set<Flushable>;
  /** Sends every pending batch now (beacon when `unloading`). */
  flush(unloading?: boolean): void;
}

/**
 * One transport per client. Every request is `credentials: "omit"`; the body is `text/plain`
 * JSON (CORS-safelisted) unless gzipped, in which case the backend's CORS allows the encoding header.
 * A 429 pauses sending to that path for `Retry-After` (capped at one hour) — per path, so a
 * recordings quota never silences error reporting.
 */
export function createTransport(dsn: Dsn): Transport {
  const pausedUntil: Record<string, number> = {};
  const queues = new Set<Flushable>();

  const transport: Transport = {
    queues,
    paused: (path) => Date.now() < (pausedUntil[path] ?? 0),
    url(path, query) {
      const params = new URLSearchParams({ key: dsn.key, ...query } as Record<string, string>);
      return `${dsn.endpoint}/${path}?${params}`;
    },
    async send(path, body, { query, beacon } = {}) {
      if (transport.paused(path)) return 0;
      const target = transport.url(path, query);
      // sendBeacon cannot set headers: a gzipped body would arrive without Content-Encoding and fail to parse,
      // so beacons carry JSON strings only; gzipped bodies on unload go through fetch keepalive
      if (
        beacon &&
        typeof body === "string" &&
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function" &&
        safe(() => navigator.sendBeacon(target, new Blob([body], { type: TEXT })))
      )
        return 0;
      const headers: Record<string, string> = { "Content-Type": TEXT };
      if (typeof body !== "string") headers["Content-Encoding"] = "gzip";
      try {
        const response = await fetch(target, {
          method: "POST",
          body: body as BodyInit,
          headers,
          credentials: "omit",
          keepalive: body.length < KEEPALIVE_MAX,
        });
        const header = response.status === 429 && response.headers.get("Retry-After");
        if (header) {
          const ms = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
          pausedUntil[path] = Date.now() + Math.min(Math.max(ms || 60_000, 1000), MAX_RETRY_MS);
        }
        return response.status;
      } catch {
        return 0;
      }
    },
    flush(unloading) {
      queues.forEach((q) => q.flush(unloading));
    },
  };

  window.addEventListener("pagehide", () => transport.flush(true));
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && transport.flush(true));

  return transport;
}
