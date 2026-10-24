/**
 * Entry without React, for Vue, plain JavaScript and the CDN build:
 *
 *   import { init, errors, maintenance, metrika } from "@trappbuild/react/browser";
 *   init({ dsn: "https://<key>@get.trapp.build/<project>", modules: [errors(), maintenance(), metrika()] });
 */
export { init, createClient, getClient, captureException, captureMessage, addBreadcrumb, setUser, setTag } from "./core/init.js";
export { errors, type ErrorsOptions, type ErrorEvent, type Frame } from "./errors/index.js";
export { maintenance, allowedMaintenanceUrl, MAINTENANCE_ORIGIN, type MaintenanceOptions } from "./maintenance/index.js";
export { metrika, type MetrikaOptions } from "./metrika/index.js";
export { recordings, type RecordingsOptions, type Interaction, type RrwebModule } from "./recordings/index.js";
export { ConsentManager, CONSENT_EVENT } from "./consent/manager.js";
export { parseRecord as parseConsentCookie } from "./consent/cookie.js";
export type { ConsentInput, ConsentLike } from "./core/consent.js";
export type { Breadcrumb, CaptureContext, Client, ClientOptions, Level, TrappModule } from "./core/types.js";
export type { StatusSnapshot, WarningAppearance } from "./core/status.js";
export {
  CONSENT_CATEGORIES,
  type ConsentCategory,
  type ConsentMethod,
  type ConsentOptions,
  type ConsentRecord,
  type ConsentState,
} from "./consent/types.js";
