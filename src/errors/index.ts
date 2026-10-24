import { safe } from "../core/env.js";
import { stripQuery } from "../core/scrub.js";
import { createBatcher, type Batcher } from "../core/batch.js";
import type { CaptureContext, Client, TrappModule } from "../core/types.js";
import { startBreadcrumbs } from "./breadcrumbs.js";
import { buildEvent, fingerprint, type ErrorEvent } from "./event.js";
import { drainGuardBuffer } from "./guard.js";

export interface ErrorsOptions {
  /** Share of errors to send, 0–1. Default: 1. */
  sampleRate?: number;
  /** Messages (or frame filenames) matching any entry are dropped. Extensions and ResizeObserver noise are built in. */
  ignoreErrors?: (string | RegExp)[];
  /** Last word before sending: modify the event or return null to drop it. */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
  /** Record console.error/warn breadcrumbs. Default: true. */
  captureConsole?: boolean;
  /** Record fetch/XHR breadcrumbs. Default: true. */
  captureNetwork?: boolean;
}

const DEFAULT_IGNORE: RegExp[] = [
  /ResizeObserver loop/,
  /^Script error\.?$/,
  /(chrome|moz|safari)-extension:\/\//,
  /^Non-Error promise rejection captured/,
];

const FLUSH_MS = 5000;
const FLUSH_AT = 20;
const DEDUPE_MS = 5000;

function matches(pattern: string | RegExp, text: string) {
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

/**
 * Error tracking: `error` and `unhandledrejection` listeners (nothing is overwritten), resource
 * load failures as `ResourceError` warnings, `captureException`/`captureMessage`, breadcrumbs,
 * stack parsing, 5-second dedupe into `count`, batches of 20 or every 5 s, beacon on pagehide.
 */
export function errors(options: ErrorsOptions = {}): TrappModule {
  return {
    name: "errors",
    setup(client: Client) {
      const transport = client.transport;
      if (!transport) return;
      const ignore = [...DEFAULT_IGNORE, ...(options.ignoreErrors ?? [])];
      const crumbs = startBreadcrumbs(client, {
        console: options.captureConsole !== false,
        network: options.captureNetwork !== false,
      });
      const batch: Batcher<ErrorEvent> = createBatcher<ErrorEvent>(transport, {
        path: "errors",
        every: FLUSH_MS,
        max: FLUSH_AT,
        serialize: (events) =>
          JSON.stringify({
            sdk: client.sdk,
            release: client.options.release,
            environment: client.options.environment,
            session: client.sessionId,
            errors: events,
          }),
      });
      let last: { key: string; event: ErrorEvent; at: number } | null = null;

      const capture = (error: unknown, message: string | undefined, context: CaptureContext) => {
        if (client.status?.collection.errors === false) return;
        if (Math.random() >= (options.sampleRate ?? 1)) return;
        let event = buildEvent(client, error, message, context, crumbs.snapshot());
        const haystack = [event.message, ...event.frames.map((f) => f.filename)];
        if (ignore.some((p) => haystack.some((h) => matches(p, h)))) return;

        const key = fingerprint(event);
        const at = Date.now();
        if (last && last.key === key && at - last.at < DEDUPE_MS && batch.pending().includes(last.event)) {
          last.event.count++;
          return;
        }
        if (options.beforeSend) {
          const result = safe(() => options.beforeSend!(event));
          if (!result) return;
          event = result;
        }
        last = { key, event, at };
        batch.push(event);
        client.emit("event", { level: event.level, type: event.type, message: event.message });
      };

      const stops = [
        client.on("capture", ({ error, message, context }) => capture(error, message, context)),
        crumbs.stop,
        batch.stop,
      ];

      const onError = (event: Event) => {
        const target = event.target;
        // Resource failures arrive in the capture phase with the element as target.
        if (target && target !== window && target instanceof Element) {
          const url = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href;
          if (!url) return;
          capture(null, `Failed to load ${target.tagName.toLowerCase()} ${stripQuery(url)}`, {
            level: "warning",
            type: "ResourceError",
            mechanism: "onerror",
          });
          return;
        }
        const e = event as globalThis.ErrorEvent;
        capture(e.error ?? e.message, e.message, { mechanism: "onerror" });
      };
      const onRejection = (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        capture(reason ?? "Unhandled promise rejection", undefined, { mechanism: "unhandledrejection" });
      };
      window.addEventListener("error", onError, true);
      window.addEventListener("unhandledrejection", onRejection);
      stops.push(
        () => window.removeEventListener("error", onError, true),
        () => window.removeEventListener("unhandledrejection", onRejection),
      );

      safe(() => drainGuardBuffer(client));
      return () => stops.forEach((s) => safe(s));
    },
  };
}

export type { ErrorEvent } from "./event.js";
export type { Frame } from "./stack.js";
