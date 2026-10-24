import { compress } from "../core/batch.js";
import { devWarn, safe } from "../core/env.js";
import type { Client } from "../core/types.js";
import { resolveRrweb, type RrwebEvent, type RrwebModule } from "./rrweb.js";

export interface ReplaySettings {
  sampleRate: number;
  onError: boolean;
  maskText: boolean;
  loadRrweb: () => Promise<unknown>;
  /** A sampled session is uploaded only once it has this many clicks… */
  minClicks: number;
  /** …and has lasted this long. Before that it stays in memory; a visit that never qualifies is never sent. */
  minDurationMs: number;
  /** Replace images with placeholders instead of recording their URLs. */
  blockImages: boolean;
  /** Share of NOT-sampled sessions that keep the rolling "last minutes before an error" buffer. */
  onErrorSampleRate: number;
  /** Don't run rrweb on weak devices or constrained networks (see `weakDevice`). */
  skipWeakDevices: boolean;
  /** Called on a 429 with Retry-After: the account's recordings quota is exhausted. */
  onQuota?: () => void;
}

export type ReplayTrigger = "sample" | "error" | "rage";

export const CHUNK_MS = 5000;
export const CHUNK_BYTES = 64 * 1024;
/** Full re-snapshot for the rolling onError buffer only; a streamed or pending-sample session never re-snapshots. */
export const BUFFER_CHECKOUT_MS = 120_000;
/** A sampled visit that has not reached the thresholds yet is dropped past this much buffered data. */
export const PENDING_MAX_BYTES = 4 * 1024 * 1024;
/** Mouse, scroll, input, viewport events are tiny; measuring each with JSON.stringify costs more than it tells. */
const SMALL_EVENT_BYTES = 120;
const AFTER_TRIGGER_MS = 30_000;
const MAX_SESSION_MS = 30 * 60_000;
const MAX_SESSION_BYTES = 10 * 1024 * 1024;
const UNCOMPRESSED_MAX = 256 * 1024;

/** Fields that are never recorded, whatever the options: passwords, card fields and the client's own markers. */
export const BLOCK_SELECTOR = '[data-trapp-block],input[type="password"],input[autocomplete^="cc-"]';
/** With `blockImages`: images too, except those marked `data-trapp-keep`. */
export const BLOCK_IMAGES_SELECTOR = `${BLOCK_SELECTOR},img:not([data-trapp-keep])`;

/** Rough size of an rrweb event: only mutations and unknown shapes are serialized to measure them. */
const sizeOf = (event: RrwebEvent) => {
  const data = event.data as { source?: number } | null;
  if (event.type === 3 && data && typeof data === "object" && data.source !== 0) return SMALL_EVENT_BYTES;
  return JSON.stringify(event).length;
};

/**
 * Devices where rrweb's DOM serialization costs visible jank or battery: ≤ 2 GB of memory, ≤ 2 cores,
 * the user's data saver, or a 2G/3G connection. Unknown values (Safari, Firefox) count as capable.
 */
export function weakDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return true;
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2) return true;
  const connection = nav.connection;
  return !!connection && (connection.saveData === true || /^(slow-2g|2g|3g)$/.test(connection.effectiveType ?? ""));
}

/** rrweb IncrementalSnapshot → MouseInteraction → Click. */
const isClick = (event: RrwebEvent) => {
  const data = (event as { type?: number; data?: { source?: number; type?: number } }).data;
  return (event as { type?: number }).type === 3 && data?.source === 2 && data.type === 2;
};

const star = (text: string) => text.replace(/\S/g, "*");

/**
 * rrweb layer. `always`: a sampled session is kept in memory until it is worth watching — at least
 * `minClicks` clicks and `minDurationMs` of recording — and then streamed from its start; a visit
 * that never gets there is never sent. `onError`: keeps the last 60–120 s in memory (two checkout
 * buffers) and streams them, plus 30 s more, when an error or rage click happens. Chunks every 5 s
 * or 64 KB → `POST replay?session&seq[&trigger&path]`. Stops on 429 (and any other refusal), after
 * 30 min, or after 10 MB.
 */
export function createReplay(client: Client, settings: ReplaySettings) {
  const transport = client.transport!;
  let stopRecord: (() => void) | undefined;
  let rrweb: RrwebModule | null = null;
  let streaming = false;
  let ended = false;
  let seq = 0;
  let bytes = 0;
  let startedAt = 0;
  let trigger: ReplayTrigger | null = null;
  /** Sampled, but not yet worth uploading: everything is buffered from the start. */
  let pendingSample = false;
  /** Picked by sampleRate: once streaming, it streams to the end (it has no checkouts to buffer with). */
  let sampledSession = false;
  let pendingBytes = 0;
  let clicks = 0;
  let firstAt = 0;
  let previous: RrwebEvent[] = [];
  let current: RrwebEvent[] = [];
  let chunk: RrwebEvent[] = [];
  let chunkSize = 0;
  let chunkTimer: ReturnType<typeof setTimeout> | undefined;
  let afterTimer: ReturnType<typeof setTimeout> | undefined;
  let sending = Promise.resolve();

  const end = (reason: string) => {
    if (ended) return;
    ended = true;
    devWarn(`replay stopped: ${reason}`);
    clearTimeout(chunkTimer);
    clearTimeout(afterTimer);
    safe(() => stopRecord?.());
    stopRecord = undefined;
    previous = current = chunk = [];
  };

  const flush = (beacon = false) => {
    clearTimeout(chunkTimer);
    chunkTimer = undefined;
    if (!chunk.length || ended) return;
    const events = chunk;
    chunk = [];
    chunkSize = 0;
    const body = JSON.stringify({ from: events[0].timestamp, to: events[events.length - 1].timestamp, events });
    if (typeof CompressionStream === "undefined" && body.length > UNCOMPRESSED_MAX) return end("chunk too large without gzip");
    bytes += body.length;
    if (bytes > MAX_SESSION_BYTES) return end("10 MB per session");
    const query: Record<string, string | number> = { session: client.sessionId, seq };
    if (seq === 0) {
      query.trigger = trigger ?? "sample";
      query.path = location.pathname.slice(0, 300);
    }
    seq++;
    sending = sending.then(async () => {
      if (ended) return;
      const status = await transport.send("replay", beacon ? body : await compress(body), { query, beacon });
      // 2xx: accepted. 0: beacon (unknown outcome) — but a lost chunk breaks the strict seq, so stop.
      // 409 (seq repeat/skip), 404 (unknown session), 413 (too large), 204 (recordings off),
      // 429 without Retry-After (10 MB / 30 min per session): this session is over.
      // 429 with Retry-After: the monthly quota — stop until status says recordings are on again.
      if (status >= 200 && status < 300 && status !== 204) return;
      if (status === 429 && transport.paused("replay")) settings.onQuota?.();
      end(status === 0 ? "chunk lost" : `server answered ${status}`);
    });
  };

  const stream = (event: RrwebEvent) => {
    chunk.push(event);
    // a full snapshot is not measured: serializing ~500 KB just to learn it is big would double the cost;
    // it leaves with the chunk it is in (timer, 64 KB of other events, or the end of startStreaming)
    if (event.type !== 2) chunkSize += sizeOf(event);
    if (chunkSize >= CHUNK_BYTES) flush();
    else if (chunkTimer === undefined) chunkTimer = setTimeout(flush, CHUNK_MS);
  };

  const qualifies = (now: number) =>
    clicks >= settings.minClicks && firstAt > 0 && now - firstAt >= settings.minDurationMs;

  const emit = (event: RrwebEvent, isCheckout?: boolean) => {
    if (ended) return;
    if (Date.now() - startedAt > MAX_SESSION_MS) return end("30 minutes per session");
    if (isClick(event)) clicks++;
    if (!firstAt && typeof event.timestamp === "number") firstAt = event.timestamp;
    if (streaming) return stream(event);
    // a pending sample keeps the whole visit, so the upload starts from the first snapshot —
    // bounded: a visit that grows past PENDING_MAX_BYTES before it qualifies is not recorded at all
    if (pendingSample) {
      pendingBytes += sizeOf(event);
      if (pendingBytes > PENDING_MAX_BYTES) return end("visit grew too large before it was worth recording");
    } else if (isCheckout) {
      previous = current;
      current = [];
    }
    current.push(event);
    if (pendingSample && qualifies(typeof event.timestamp === "number" ? event.timestamp : Date.now())) {
      pendingSample = false;
      startStreaming("sample");
    }
  };

  const startStreaming = (reason: ReplayTrigger) => {
    if (streaming || ended || !stopRecord) return;
    streaming = true;
    if (trigger === null) trigger = reason;
    for (const event of [...previous, ...current]) stream(event);
    previous = current = [];
    flush();
    if (reason !== "sample" && !sampledSession) {
      afterTimer = setTimeout(() => {
        flush();
        streaming = false;
        // Back to buffering; a fresh snapshot keeps the next buffer replayable.
        safe(() => rrweb?.record.takeFullSnapshot?.(true));
      }, AFTER_TRIGGER_MS);
    }
  };

  return {
    async start() {
      if (stopRecord || ended) return;
      const sampled = Math.random() < settings.sampleRate;
      // the rolling buffer costs a full DOM snapshot and every mutation for the whole visit — sample it too
      const buffering = !sampled && settings.onError && Math.random() < settings.onErrorSampleRate;
      if (!sampled && !buffering) return;
      if (settings.skipWeakDevices && weakDevice()) return devWarn("replay skipped: weak device or constrained network");
      // without gzip the first chunk (the full snapshot) exceeds the server limit — don't download rrweb for nothing
      if (typeof CompressionStream === "undefined") return devWarn("replay skipped: no CompressionStream");
      try {
        rrweb = resolveRrweb(await settings.loadRrweb());
      } catch (error) {
        devWarn("rrweb could not be loaded", error);
      }
      if (!rrweb) return devWarn("rrweb module not found");
      if (ended || stopRecord) return;
      startedAt = Date.now();
      stopRecord = safe(() =>
        rrweb!.record({
          emit,
          // only the rolling buffer needs periodic full snapshots; a sampled visit is kept/streamed whole
          checkoutEveryNms: sampled ? undefined : BUFFER_CHECKOUT_MS,
          maskAllInputs: true,
          maskInputOptions: { password: true },
          blockSelector: settings.blockImages ? BLOCK_IMAGES_SELECTOR : BLOCK_SELECTOR,
          maskTextSelector: settings.maskText ? "*" : "[data-trapp-mask]",
          maskTextFn: star,
          inlineImages: false,
          inlineStylesheet: true,
          recordCanvas: false,
          sampling: { mousemove: 50, scroll: 150, input: "last" },
          slimDOMOptions: true,
        }),
      );
      if (!stopRecord) return end("rrweb.record failed");
      if (sampled) {
        sampledSession = true;
        pendingSample = true;
        // thresholds of 0 — upload right away, as before
        if (qualifies(Date.now()) || (settings.minClicks <= 0 && settings.minDurationMs <= 0)) {
          pendingSample = false;
          startStreaming("sample");
        }
      }
    },
    /** An error or rage click: send the buffer and keep going for 30 s. */
    trigger(reason: "error" | "rage", payload?: unknown) {
      // rrweb throws when a custom event arrives while nothing is recording
      if (ended || !stopRecord) return;
      safe(() => rrweb?.addCustomEvent?.(`trapp:${reason}`, payload ?? {}));
      if (settings.onError) {
        pendingSample = false;
        startStreaming(reason);
      }
    },
    flush,
    stop: () => end("stopped"),
    recording: () => !!stopRecord && !ended,
    streaming: () => streaming,
  };
}
