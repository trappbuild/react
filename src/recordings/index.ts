import { createBatcher } from "../core/batch.js";
import { safe } from "../core/env.js";
import { fetchStatus } from "../core/status.js";
import type { Client, TrappModule } from "../core/types.js";
import { FLUSH_AT, FLUSH_MS, startInteractions, type Interaction } from "./interactions.js";
import { createReplay } from "./replay.js";
import { defaultLoader } from "./rrweb.js";

export interface RecordingsOptions {
  /** Share of sessions recorded from the start (`always` mode). Default: 0.1. */
  sampleRate?: number;
  /** Keep the last 60 s in memory and send them when an error or rage click happens. Default: true. */
  onError?: boolean;
  /** Mask all page text with asterisks (inputs are always masked). Default: false. */
  maskText?: boolean;
  /** Upload a sampled session only after this many clicks. Default: 4 (the dashboard setting wins). */
  minClicks?: number;
  /** …and only after this many seconds. Default: 10 (the dashboard setting wins). */
  minDurationSec?: number;
  /**
   * Replace images with placeholders (except `img[data-trapp-keep]`). Default: false — images are
   * recorded as their URLs and loaded by the player, so the replay looks like the real page.
   */
  blockImages?: boolean;
  /**
   * Share of the sessions NOT picked by `sampleRate` that keep the rolling buffer for `onError`.
   * Default: 0.2 — the buffer re-snapshots the page every 2 minutes and records every mutation, so
   * running it for everyone would cost every visitor CPU and memory for the rare error replay.
   */
  onErrorSampleRate?: number;
  /** Skip rrweb on weak devices (≤ 2 GB memory, ≤ 2 cores, data saver, 2G/3G). Default: true. */
  skipWeakDevices?: boolean;
  /** Collect clicks, scroll depth and form steps (the light layer). Default: true. */
  interactions?: boolean;
  /** How to load rrweb; `() => import("rrweb")` lets your bundler create a lazy chunk. */
  loadRrweb?: () => Promise<unknown>;
}

/**
 * Click recordings: the light interactions layer in the main bundle, and rrweb session replay
 * loaded on demand — only with "statistics" consent, only when the project has recordings
 * enabled (`status.collection.recordings`) and the session passes sampling. Settings from the
 * dashboard (`status.recordings`) override the options given here.
 */
export function recordings(options: RecordingsOptions = {}): TrappModule {
  return {
    name: "recordings",
    setup(client: Client) {
      const transport = client.transport;
      if (!transport) return;
      const stops: (() => void)[] = [];

      // Interactions are cheap and the server enforces the project switch; replay is fail-closed.
      const interactionsAllowed = () => client.consent.granted() && client.status?.collection.recordings !== false;
      const replayAllowed = () => client.consent.granted() && client.status?.collection.recordings === true;

      if (options.interactions !== false) {
        const batch = createBatcher<Interaction>(transport, {
          path: "interactions",
          every: FLUSH_MS,
          max: FLUSH_AT,
          serialize: (events) => JSON.stringify({ sdk: client.sdk, session: client.sessionId, events }),
        });
        stops.push(startInteractions(client, batch, interactionsAllowed), batch.stop);
      }

      let replay: ReturnType<typeof createReplay> | null = null;
      let quotaExceeded = false;
      const maybeStart = () => {
        if (replay || quotaExceeded || !replayAllowed()) return;
        const server = client.status?.recordings ?? {};
        replay = createReplay(client, {
          sampleRate: server.sampleRate ?? options.sampleRate ?? 0.1,
          onError: server.onError ?? options.onError ?? true,
          maskText: server.maskText ?? options.maskText ?? false,
          minClicks: server.minClicks ?? options.minClicks ?? 4,
          minDurationMs: (server.minDurationSec ?? options.minDurationSec ?? 10) * 1000,
          blockImages: options.blockImages ?? false,
          onErrorSampleRate: options.onErrorSampleRate ?? 0.2,
          skipWeakDevices: options.skipWeakDevices ?? true,
          loadRrweb: options.loadRrweb ?? defaultLoader,
          onQuota: () => {
            quotaExceeded = true;
          },
        });
        void replay.start();
      };

      stops.push(
        client.on("status", (status) => {
          // The server flips collection.recordings back on when quota allows recordings again.
          if (status.collection.recordings === true && !replay) quotaExceeded = false;
          maybeStart();
        }),
        client.consent.subscribe((granted) => {
          if (granted) maybeStart();
          else {
            replay?.stop();
            replay = null;
          }
        }),
        client.on("event", ({ level, type, message }) => {
          if (level === "error" || level === "fatal") replay?.trigger("error", { type, message });
        }),
        client.on("rage", (payload) => replay?.trigger("rage", payload)),
      );

      const onHide = () => replay?.flush(true);
      window.addEventListener("pagehide", onHide);
      stops.push(() => window.removeEventListener("pagehide", onHide));

      // Without the maintenance module nobody polls status, and replay needs it to be sure.
      const polled = (client.options.modules ?? []).some((m) => m.name === "maintenance");
      if (!polled && !client.status) {
        void fetchStatus(transport).then((status) => status && client.setStatus(status));
      }
      maybeStart();

      return () => {
        replay?.stop();
        stops.forEach((s) => safe(s));
      };
    },
  };
}

export type { Interaction } from "./interactions.js";
export type { RrwebModule } from "./rrweb.js";
