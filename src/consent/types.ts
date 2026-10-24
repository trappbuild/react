export type ConsentCategory = "necessary" | "preferences" | "statistics" | "marketing";

/** Fired on `window` after every change; `detail` is the new record, or null after `reset()`. */
export const CONSENT_EVENT = "trapp:consent";

export const CONSENT_CATEGORIES: ConsentCategory[] = [
  "necessary",
  "preferences",
  "statistics",
  "marketing",
];

export type ConsentState = Record<ConsentCategory, boolean>;

/** `reset` is a withdrawal: the stored decision was deleted. */
export type ConsentMethod = "accept_all" | "reject_all" | "custom" | "reset";

/** What gets stored in the consent cookie (and optionally reported as proof of consent). */
export interface ConsentRecord {
  /** Stable per-browser consent id, kept across updates and policy versions. */
  id: string;
  /** Policy version. Bumping `version` in options re-asks every visitor. */
  version: number;
  /** ISO timestamp of the last decision. */
  timestamp: string;
  method: ConsentMethod;
  categories: ConsentState;
}

export interface ConsentOptions {
  /** Cookie that stores the decision. Default: `trapp_consent`. */
  cookieName?: string;
  /** Days until the visitor is asked again. Default: 365. */
  expiresDays?: number;
  /** Policy version — increase it when your cookie policy changes. Default: 1. */
  version?: number;
  /** Cookie domain, e.g. `.example.com` to share consent across subdomains. */
  cookieDomain?: string;
  /**
   * If set, every decision (and every withdrawal) is POSTed here as proof of consent, e.g.
   * `https://get.trapp.build/api/<project_id>/consent?key=<public_key>` — the `?key=` is required.
   * The body is JSON (`categories` is the list of granted names, `url` is origin + path) sent as
   * `text/plain`, so cross-origin requests need no CORS preflight.
   */
  reportUrl?: string;
  /** Sent along with the report so the backend knows which project it belongs to. */
  projectId?: string;
  /**
   * Reload the page when a previously granted category is withdrawn, so
   * scripts that already ran stop working. Default: false.
   */
  reloadOnWithdraw?: boolean;
  /**
   * Raw value of the consent cookie, read on the server (e.g. `cookies().get("trapp_consent")?.value`
   * in Next.js). Lets `useConsent()` / `<ConsentGate>` render the right thing during SSR.
   */
  initialCookie?: string | null;
  /**
   * Send Google Consent Mode v2 signals (`gtag("consent", "default" | "update", …)`)
   * through `window.dataLayer`. Default: false.
   */
  googleConsentMode?: boolean;
}

export type ResolvedConsentOptions = Required<
  Pick<
    ConsentOptions,
    "cookieName" | "expiresDays" | "version" | "reloadOnWithdraw" | "googleConsentMode"
  >
> &
  Pick<ConsentOptions, "cookieDomain" | "reportUrl" | "projectId" | "initialCookie">;
