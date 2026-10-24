import { safe } from "../core/env.js";
import { deleteCookie, parseRecord, readCookie, writeCookie } from "./cookie.js";
import { googleConsentDefault, googleConsentUpdate } from "./google.js";
import { activateScripts, observeBlockedElements } from "./scripts.js";
import {
  CONSENT_CATEGORIES,
  CONSENT_EVENT,
  type ConsentCategory,
  type ConsentMethod,
  type ConsentOptions,
  type ConsentRecord,
  type ConsentState,
  type ResolvedConsentOptions,
} from "./types.js";

export { CONSENT_EVENT };

const ONLY_NECESSARY: ConsentState = {
  necessary: true,
  preferences: false,
  statistics: false,
  marketing: false,
};

const ALL_GRANTED: ConsentState = {
  necessary: true,
  preferences: true,
  statistics: true,
  marketing: true,
};

// Pending scripts must not use a provider's old consent after it unmounts.
const INACTIVE_STATE: ConsentState = {
  necessary: false,
  preferences: false,
  statistics: false,
  marketing: false,
};

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isWithdrawal(previous: ConsentState | undefined, next: ConsentState) {
  return !!previous && CONSENT_CATEGORIES.some((c) => previous[c] && !next[c]);
}

/**
 * Framework-agnostic consent store. The React bindings subscribe to it, and
 * future SDKs (vanilla script tag, Vue, …) can reuse it as-is.
 *
 * The constructor has no side effects; call `start()` once in the browser to
 * activate blocked scripts and begin syncing with other tabs.
 */
export class ConsentManager {
  private readonly options: ResolvedConsentOptions;
  private record: ConsentRecord | null;
  /** Id of a decision made under an older policy version — reused so the history stays linked. */
  private staleId: string | undefined;
  /** Last cookie value we saw, to detect changes made by other tabs. */
  private rawCookie: string | null;
  private readonly listeners = new Set<() => void>();
  private activeStarts = 0;
  private scriptsStopped = false;
  private getScriptState = (): ConsentState => this.scriptsStopped ? INACTIVE_STATE : this.getState();

  constructor(options: ConsentOptions = {}) {
    this.options = {
      cookieName: options.cookieName ?? "trapp_consent",
      expiresDays: options.expiresDays ?? 365,
      version: options.version ?? 1,
      reloadOnWithdraw: options.reloadOnWithdraw ?? false,
      googleConsentMode: options.googleConsentMode ?? false,
      cookieDomain: options.cookieDomain,
      reportUrl: options.reportUrl,
      projectId: options.projectId,
      initialCookie: options.initialCookie,
    };

    // In the browser the cookie is the source of truth; on the server use what the app passed in.
    this.rawCookie =
      typeof document !== "undefined"
        ? readCookie(this.options.cookieName)
        : (options.initialCookie ?? null);
    this.record = this.load(this.rawCookie);
  }

  /** Current record, or null if the visitor hasn't decided yet. Stable reference between changes. */
  getRecord = (): ConsentRecord | null => this.record;

  getState(): ConsentState {
    return this.record?.categories ?? ONLY_NECESSARY;
  }

  hasDecided(): boolean {
    return this.record !== null;
  }

  has(category: ConsentCategory): boolean {
    return category === "necessary" || this.getState()[category];
  }

  /**
   * Browser-only start-up: activates already-consented blocked scripts, watches for new
   * ones, sends Google Consent Mode defaults and syncs with other tabs. Returns a stop function.
   * Safe to call more than once (e.g. React StrictMode).
   */
  start = (): (() => void) => {
    if (typeof window === "undefined") return () => {};

    this.activeStarts++;
    this.scriptsStopped = false;

    // Nothing in start-up may throw into the host's render cycle.
    if (this.options.googleConsentMode && !this.googleDefaultSent) {
      safe(() => googleConsentDefault(this.getState()));
      this.googleDefaultSent = true;
    }
    safe(() => activateScripts(this.getScriptState));
    const stopObserving = safe(() => observeBlockedElements(this.getScriptState)) ?? (() => {});

    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(`trapp-consent:${this.options.cookieName}`)
        : null;
    const sync = () => this.syncFromCookie();
    if (channel) channel.onmessage = sync;
    this.channel = channel;
    // Fallback for browsers without BroadcastChannel, and for changes made on another subdomain.
    const onVisible = () => document.visibilityState === "visible" && sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", sync);

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.scriptsStopped = --this.activeStarts === 0;
      stopObserving();
      channel?.close();
      if (this.channel === channel) this.channel = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", sync);
    };
  };

  acceptAll() {
    this.commit(ALL_GRANTED, "accept_all");
  }

  rejectAll() {
    this.commit(ONLY_NECESSARY, "reject_all");
  }

  save(categories: Partial<ConsentState>) {
    this.commit({ ...ONLY_NECESSARY, ...categories, necessary: true }, "custom");
  }

  /** Forget the decision — the banner will be shown again. Reported as a withdrawal. */
  reset() {
    const previous = this.record;
    deleteCookie(this.options.cookieName, this.options.cookieDomain);
    this.rawCookie = null;
    this.record = null;
    if (previous) {
      this.staleId = previous.id;
      this.report({
        ...previous,
        timestamp: new Date().toISOString(),
        method: "reset",
        categories: { ...ONLY_NECESSARY },
      });
    }
    this.channel?.postMessage("change");
    this.applied(previous?.categories, null);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private channel: BroadcastChannel | null = null;
  private googleDefaultSent = false;

  private load(raw: string | null): ConsentRecord | null {
    const stored = parseRecord(raw);
    // A decision made under an older policy version doesn't count, but keep its id.
    if (stored && stored.version !== this.options.version) {
      this.staleId = stored.id;
      return null;
    }
    return stored;
  }

  private commit(categories: ConsentState, method: ConsentMethod) {
    const previous = this.record?.categories;

    const record: ConsentRecord = {
      id: this.record?.id ?? this.staleId ?? randomId(),
      version: this.options.version,
      timestamp: new Date().toISOString(),
      method,
      categories: { ...categories },
    };

    const value = JSON.stringify(record);
    writeCookie(this.options.cookieName, value, {
      days: this.options.expiresDays,
      domain: this.options.cookieDomain,
    });
    this.rawCookie = readCookie(this.options.cookieName);
    this.record = record;

    this.report(record);
    this.channel?.postMessage("change");
    this.applied(previous, record);
  }

  /** Picks up a decision made in another tab (or subdomain). */
  private syncFromCookie() {
    const raw = readCookie(this.options.cookieName);
    if (raw === this.rawCookie) return;
    this.rawCookie = raw;
    const previous = this.record?.categories;
    this.record = this.load(raw);
    this.applied(previous, this.record);
  }

  /** Everything that follows a change of the effective state, wherever it came from. */
  private applied(previous: ConsentState | undefined, record: ConsentRecord | null) {
    const state = record?.categories ?? ONLY_NECESSARY;

    if (this.options.googleConsentMode) safe(() => googleConsentUpdate(state));
    safe(() => activateScripts(this.getScriptState));
    if (typeof window !== "undefined") {
      safe(() => window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: record })));
    }
    this.notify();

    if (isWithdrawal(previous, state) && this.options.reloadOnWithdraw && typeof location !== "undefined") {
      location.reload();
    }
  }

  /**
   * Proof of consent for the backend (`POST /api/<project>/consent?key=…`): the record with
   * `categories` as the list of granted names, plus the page without query or hash. No user
   * agent — the server already has it from the request.
   */
  private report(record: ConsentRecord) {
    const { reportUrl, projectId } = this.options;
    if (!reportUrl || typeof window === "undefined") return;

    const body = JSON.stringify({
      id: record.id,
      version: record.version,
      timestamp: record.timestamp,
      method: record.method,
      categories: CONSENT_CATEGORIES.filter((c) => record.categories[c] === true),
      projectId,
      url: location.origin + location.pathname,
    });

    // text/plain is CORS-safelisted: no preflight, and sendBeacon accepts it cross-origin.
    // sendBeacon survives page unloads (e.g. reloadOnWithdraw); fall back to fetch.
    try {
      const sent =
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(reportUrl, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      if (!sent) {
        fetch(reportUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body,
          keepalive: true,
          credentials: "omit",
        }).catch(() => {});
      }
    } catch {
      // Reporting is best effort; the decision itself is already stored.
    }
  }

  private notify() {
    this.listeners.forEach((listener) => safe(listener));
  }
}
