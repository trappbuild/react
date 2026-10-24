import { CONSENT_EVENT } from "../consent/types.js";
import { safe } from "./env.js";

/** Minimal shape of `ConsentManager` so the core doesn't need the class itself. */
export interface ConsentLike {
  getState(): Record<string, boolean>;
  subscribe(listener: () => void): () => void;
}

/**
 * How the client learns about consent: `true`/`false`, a category map such as
 * `{ statistics: true }` from a third-party banner, or a `ConsentManager`.
 * Omit it to follow the `trapp_consent` cookie and the `trapp:consent` event.
 */
export type ConsentInput = boolean | Partial<Record<string, boolean>> | ConsentLike | null | undefined;

export interface ConsentBridge {
  /** Whether "statistics" is granted right now. */
  granted(): boolean;
  subscribe(listener: (granted: boolean) => void): () => void;
  set(input: ConsentInput): void;
  /** Starts listening to the window event; returns a stop function. */
  start(): () => void;
}

/** `statistics === true` as an own property — never via the prototype chain. */
function statistics(state: unknown): boolean {
  return typeof state === "object" && state !== null && Object.prototype.hasOwnProperty.call(state, "statistics") && (state as Record<string, unknown>).statistics === true;
}

/** The consent cookie's `categories.statistics`; anything malformed counts as not granted. */
function fromCookie(name: string): boolean {
  return (
    safe(() => {
      const raw = document.cookie.split("; ").find((p) => p.startsWith(name + "="));
      return raw ? statistics(JSON.parse(decodeURIComponent(raw.slice(name.length + 1))).categories) : false;
    }) === true
  );
}

/**
 * Bridges the consent banner (ours or a third-party one) to the modules: metrika and
 * recordings only run while "statistics" is granted. Errors never need it.
 */
export function createConsentBridge(initial: ConsentInput, cookieName = "trapp_consent"): ConsentBridge {
  const listeners = new Set<(granted: boolean) => void>();
  let value = false;
  let unsubscribe: (() => void) | undefined;
  let manual = false;

  const update = (next: boolean) => {
    if (next === value) return;
    value = next;
    listeners.forEach((l) => safe(() => l(next)));
  };

  const set = (input: ConsentInput) => {
    unsubscribe?.();
    unsubscribe = undefined;
    manual = input != null;
    if (typeof input === "boolean") update(input);
    else if (input && typeof (input as ConsentLike).subscribe === "function") {
      const manager = input as ConsentLike;
      unsubscribe = manager.subscribe(() => update(statistics(manager.getState())));
      update(statistics(manager.getState()));
    } else if (input) update(statistics(input));
    else update(typeof document !== "undefined" && fromCookie(cookieName));
  };

  set(initial);

  return {
    granted: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    start() {
      if (typeof window === "undefined") return () => {};
      // A ConsentManager anywhere on the page announces every change; the cookie covers the start.
      const onEvent = (event: Event) => manual || update(statistics((event as CustomEvent).detail?.categories));
      window.addEventListener(CONSENT_EVENT, onEvent);
      return () => window.removeEventListener(CONSENT_EVENT, onEvent);
    },
  };
}
