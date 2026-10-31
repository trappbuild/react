import { safe } from "../core/env.js";
import { watchRoutes } from "../core/routes.js";
import type { Client, TrappModule } from "../core/types.js";

/** `POST /api/<project>/hit` body (back/src/model.rs `HitIn`); one hit per request. */
interface Hit {
  type: "pageview" | "leave" | "event";
  path: string;
  url: string;
  referrer?: string;
  utm?: Record<string, string>;
  durationMs?: number;
  /** `event` only: the name a goal in the dashboard matches. */
  name?: string;
}

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"];
const BACKGROUND_LEAVE_MS = 30_000;
const PATH_MAX = 300;
const EVENT_NAME_MAX = 100;

/** Sender of the running metrika module; `track` before setup or after teardown does nothing. */
let tracker: ((name: string) => void) | undefined;

/**
 * A goal event — `track("signup")` after a sign-up, `track("purchase")` after a payment. A goal of type
 * "event" with the same name in the dashboard (Metrics → Goals) counts the visitors who reached it and the
 * conversion by channel, source, campaign and entry page. Only the name and the current path are sent —
 * no properties, so no personal data can slip in. Follows the same consent rule as page views.
 */
export function track(name: string): void {
  safe(() => tracker?.(name));
}

function utmFrom(search: string): Record<string, string> | undefined {
  const params = new URLSearchParams(search);
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`);
    if (value) utm[key] = value.slice(0, 200);
  }
  return Object.keys(utm).length ? utm : undefined;
}

export interface MetrikaOptions {
  /**
   * Wait for "statistics" consent before sending anything. Default: true.
   * Metrika is cookieless (no cookies, no localStorage; the server keeps only a daily-salted hash
   * of IP + User-Agent and drops it the next day), so a site may choose to count every visit and
   * rely on legitimate interest instead — set `false` and say so in your privacy policy.
   */
  requireConsent?: boolean;
}

/**
 * Metrika: `pageview` on load and on every route change, `leave` with the time on page at
 * `pagehide` and after 30 s in a background tab. Path without query, referrer and UTM as they
 * are — the server derives the source and counts visitors with a daily salt (no cookies).
 * By default nothing is sent or buffered before "statistics" consent; afterwards the current
 * page is sent.
 */
export function metrika(options: MetrikaOptions = {}): TrappModule {
  const requireConsent = options.requireConsent !== false;
  return {
    name: "metrika",
    setup(client: Client) {
      const transport = client.transport;
      if (!transport) return;
      let path = location.pathname;
      let startedAt = 0;
      let viewed = false;
      let first = true;
      let hideTimer: ReturnType<typeof setTimeout> | undefined;

      const allowed = () => (!requireConsent || client.consent.granted()) && client.status?.collection.metrika !== false;
      const post = (hit: Hit, beacon = false) => void transport.send("hit", JSON.stringify(hit), { beacon });

      const view = (referrer: string | undefined) => {
        if (viewed || !allowed()) return;
        viewed = true;
        startedAt = Date.now();
        const hit: Hit = { type: "pageview", path: path.slice(0, PATH_MAX), url: location.origin + path };
        if (referrer) hit.referrer = referrer.slice(0, 500);
        if (first) {
          const utm = utmFrom(location.search);
          if (utm) hit.utm = utm;
        }
        first = false;
        post(hit);
      };

      tracker = (name) => {
        const event = String(name).trim().slice(0, EVENT_NAME_MAX);
        if (!event || !allowed()) return;
        post({ type: "event", path: path.slice(0, PATH_MAX), url: location.origin + path, name: event });
      };

      const leave = (beacon: boolean) => {
        if (!viewed) return;
        viewed = false;
        post({ type: "leave", path: path.slice(0, PATH_MAX), url: location.origin + path, durationMs: Date.now() - startedAt }, beacon);
      };

      const stops = [
        watchRoutes((next, previous) => {
          leave(false);
          path = next;
          view(location.origin + previous);
        }),
        client.consent.subscribe((granted) => granted && view(document.referrer)),
        client.on("status", () => view(document.referrer)),
      ];

      const onHide = () => leave(true);
      const onVisibility = () => {
        clearTimeout(hideTimer);
        if (document.visibilityState === "hidden") hideTimer = setTimeout(() => leave(false), BACKGROUND_LEAVE_MS);
        else view(undefined);
      };
      window.addEventListener("pagehide", onHide);
      document.addEventListener("visibilitychange", onVisibility);
      stops.push(
        () => window.removeEventListener("pagehide", onHide),
        () => document.removeEventListener("visibilitychange", onVisibility),
        () => clearTimeout(hideTimer),
        () => (tracker = undefined),
      );

      view(document.referrer);
      return () => stops.forEach((s) => safe(s));
    },
  };
}
