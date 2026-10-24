// Client-side PII scrubbing. Mirrors back/src/pipeline.rs so data leaves the browser already clean.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const AUTH = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SECRET =
  /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|authorization|session|cookie|sentry_key|key)=([^&\s]+)/gi;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PHONE = /\+\d[\d\s().-]{6,}\d/g;

export function scrub(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(AUTH, "$1 [filtered]")
    .replace(SECRET, "$1=[filtered]")
    .replace(CARD, "[filtered]")
    .replace(PHONE, "[phone]");
}

/** URL without query and hash: parameters often carry tokens and e-mail addresses. */
export function stripQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

/** Current page as `origin + pathname`, never the query. */
export function pageUrl(): string {
  return location.origin + location.pathname;
}
