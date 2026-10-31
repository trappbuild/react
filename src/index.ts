// ---- Trapp.build client: errors, availability, metrika, recordings ----
export { TrappProvider, type TrappProviderProps } from "./react/TrappProvider.js";
export { TrappErrorBoundary, type TrappErrorBoundaryProps } from "./react/TrappErrorBoundary.js";
export { useTrapp } from "./react/context.js";
export { init, createClient, getClient, captureException, captureMessage, addBreadcrumb, setUser, setTag } from "./core/init.js";
export { errors, type ErrorsOptions, type ErrorEvent, type Frame } from "./errors/index.js";
export { maintenance, allowedMaintenanceUrl, MAINTENANCE_ORIGIN, type MaintenanceOptions } from "./maintenance/index.js";
export { metrika, track, type MetrikaOptions } from "./metrika/index.js";
export { recordings, type RecordingsOptions, type Interaction, type RrwebModule } from "./recordings/index.js";
export type { ConsentInput, ConsentLike } from "./core/consent.js";
export type { Breadcrumb, CaptureContext, Client, ClientOptions, Level, TrappModule } from "./core/types.js";
export type { StatusSnapshot, WarningAppearance } from "./core/status.js";

// ---- Cookie consent (Cookiebot-like) ----
export { ConsentProvider, type ConsentProviderProps } from "./consent/ConsentProvider.js";
export { CookieBanner, type CookieBannerProps } from "./consent/CookieBanner.js";
export { ConsentGate, type ConsentGateProps } from "./consent/ConsentGate.js";
export { useConsent, type ConsentContextValue } from "./consent/context.js";
export { ConsentManager, CONSENT_EVENT } from "./consent/manager.js";
/** Parse a raw consent cookie value. Server code should import from @trappbuild/react/server. */
export { parseRecord as parseConsentCookie } from "./consent/cookie.js";
export {
  DEFAULT_TEXTS,
  type ConsentLocale,
  type ConsentTexts,
  type ConsentTextsOverride,
} from "./consent/i18n.js";
export {
  CONSENT_CATEGORIES,
  type ConsentCategory,
  type ConsentMethod,
  type ConsentOptions,
  type ConsentRecord,
  type ConsentState,
} from "./consent/types.js";
