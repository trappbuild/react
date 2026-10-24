import type { ConsentState } from "./types.js";

/**
 * Google Consent Mode v2. Commands go through `window.gtag` if present, otherwise straight
 * into `window.dataLayer` (gtag.js replays the queue when it loads).
 */
type ConsentValue = "granted" | "denied";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function gtag(...args: unknown[]) {
  if (typeof window === "undefined") return;
  if (typeof window.gtag === "function") {
    window.gtag(...args);
    return;
  }
  if (!window.dataLayer) window.dataLayer = [];
  const dataLayer = window.dataLayer;
  // gtag.js only recognises commands pushed as an `arguments` object, not as an array.
  (function (..._: unknown[]) {
    dataLayer.push(arguments);
  })(...args);
}

export function googleConsentSignals(state: ConsentState): Record<string, ConsentValue> {
  const v = (granted: boolean): ConsentValue => (granted ? "granted" : "denied");
  return {
    ad_storage: v(state.marketing),
    ad_user_data: v(state.marketing),
    ad_personalization: v(state.marketing),
    analytics_storage: v(state.statistics),
    functionality_storage: v(state.preferences),
    personalization_storage: v(state.preferences),
    security_storage: "granted",
  };
}

export function googleConsentDefault(state: ConsentState) {
  gtag("consent", "default", { ...googleConsentSignals(state), wait_for_update: 500 });
}

export function googleConsentUpdate(state: ConsentState) {
  gtag("consent", "update", googleConsentSignals(state));
}
