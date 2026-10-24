import { createConsentBridge, type ConsentInput } from "./consent.js";
import { parseDsn } from "./dsn.js";
import { devWarn, isBrowser, safe } from "./env.js";
import { getSessionId } from "./session.js";
import { createTransport } from "./transport.js";
import type { Client, ClientEvents, ClientOptions, GuardEntry } from "./types.js";
import { SDK_NAME, SDK_VERSION } from "./version.js";

declare global {
  interface Window {
    __trapp?: { buffer?: GuardEntry[]; ready?: () => void };
  }
}

const MAX_TAGS = 30;

let current: Client | null = null;

/** The most recently started client, for the module-level helpers. */
export function getClient(): Client | null {
  return current;
}

/** Builds a client without side effects; `start()` wires the modules. */
export function createClient(options: ClientOptions): Client {
  const browser = isBrowser();
  const dsn = parseDsn(options.dsn);
  const transport = dsn && browser ? createTransport(dsn) : null;
  const consent = createConsentBridge(options.consent, options.consentCookie);
  const handlers = new Map<string, Set<(payload: never) => void>>();
  let starts = 0;
  let teardown: (() => void)[] = [];
  // Emitted before start() — e.g. a crash during the very first render — and replayed to the modules.
  let early: [string, unknown][] | null = [];

  const client: Client = {
    options,
    dsn,
    transport,
    consent,
    sessionId: browser ? getSessionId() : "",
    sdk: { name: SDK_NAME, version: SDK_VERSION },
    user: null,
    tags: {},
    status: null,

    on(event, handler) {
      let set = handlers.get(event);
      if (!set) handlers.set(event, (set = new Set()));
      set.add(handler as (payload: never) => void);
      return () => set!.delete(handler as (payload: never) => void);
    },

    emit(event, payload) {
      if (early && early.length < 50) early.push([event, payload]);
      handlers.get(event)?.forEach((h) => safe(() => (h as (p: ClientEvents[typeof event]) => void)(payload)));
    },

    captureException(error, context = {}) {
      client.emit("capture", { error, context: { mechanism: "manual", ...context } });
    },

    captureMessage(message, context = {}) {
      client.emit("capture", { error: null, message, context: { level: "info", mechanism: "manual", ...context } });
    },

    addBreadcrumb({ category, message, level = "info" }) {
      client.emit("breadcrumb", { ts: new Date().toISOString(), category, message, level });
    },

    setUser(user) {
      if (user && !consent.granted()) return devWarn("setUser needs statistics consent");
      client.user = user && typeof user.id === "string" ? { id: user.id.slice(0, 128) } : null;
    },

    setTag(key, value) {
      if (!(key in client.tags) && Object.keys(client.tags).length >= MAX_TAGS) return devWarn("too many tags", key);
      client.tags[key.slice(0, 64)] = String(value).slice(0, 200);
    },

    setConsent(input: ConsentInput) {
      consent.set(input);
    },

    setStatus(status) {
      client.status = status;
      client.emit("status", status);
    },

    start() {
      if (!transport) return () => {};
      if (starts++ === 0) {
        current = client;
        const replay = early ?? [];
        early = null;
        teardown = [consent.start()];
        for (const module of options.modules ?? []) {
          const stop = safe(() => module.setup(client));
          if (typeof stop === "function") teardown.push(stop);
        }
        for (const [event, payload] of replay) client.emit(event as keyof ClientEvents, payload as never);
      }
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        if (--starts > 0) return;
        teardown.splice(0).forEach((fn) => safe(fn));
        if (current === client) current = null;
      };
    },
  };

  return client;
}

// ---- Module-level helpers that forward to the active client (handy outside React) ----

export const captureException: Client["captureException"] = (error, context) => current?.captureException(error, context);
export const captureMessage: Client["captureMessage"] = (message, context) => current?.captureMessage(message, context);
export const addBreadcrumb: Client["addBreadcrumb"] = (crumb) => current?.addBreadcrumb(crumb);
export const setUser: Client["setUser"] = (user) => current?.setUser(user);
export const setTag: Client["setTag"] = (key, value) => current?.setTag(key, value);
