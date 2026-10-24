/** Utilities that can run directly in Server Components, middleware, and other server code. */
export { parseRecord as parseConsentCookie } from "./consent/cookie.js";
export {
  CONSENT_CATEGORIES,
  type ConsentCategory,
  type ConsentMethod,
  type ConsentOptions,
  type ConsentRecord,
  type ConsentState,
} from "./consent/types.js";
