import { CONSENT_CATEGORIES, type ConsentMethod, type ConsentRecord, type ConsentState } from "./types.js";

const METHODS: ConsentMethod[] = ["accept_all", "reject_all", "custom", "reset"];
const ID_MAX = 64;

const isBrowser = () => typeof document !== "undefined";

export function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const prefix = name + "=";
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

export function writeCookie(
  name: string,
  value: string,
  { days, domain }: { days: number; domain?: string },
) {
  if (!isBrowser()) return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  let cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  if (domain) cookie += `; domain=${domain}`;
  if (location.protocol === "https:") cookie += "; Secure";
  document.cookie = cookie;
}

export function deleteCookie(name: string, domain?: string) {
  writeCookie(name, "", { days: -1, domain });
}

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Parses and validates a stored record; anything malformed counts as "no decision".
 * Accepts both the raw (URI-encoded) cookie value and an already decoded one,
 * since server frameworks differ in what they hand you.
 *
 * The result is a fresh object holding only the known fields, so a tampered cookie
 * cannot smuggle extra keys (or a `__proto__`) into the app.
 */
export function parseRecord(raw: string | null | undefined): ConsentRecord | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw.startsWith("{") ? raw : decode(raw));
    if (typeof data !== "object" || data === null) return null;
    const { id, version, timestamp, method, categories } = data as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !id ||
      id.length > ID_MAX ||
      typeof version !== "number" ||
      !Number.isFinite(version) ||
      typeof timestamp !== "string" ||
      typeof method !== "string" ||
      !METHODS.includes(method as ConsentMethod) ||
      typeof categories !== "object" ||
      categories === null
    ) {
      return null;
    }
    const state = {} as ConsentState;
    for (const category of CONSENT_CATEGORIES) {
      const value = (categories as Record<string, unknown>)[category];
      if (typeof value !== "boolean") return null;
      state[category] = value;
    }
    return { id, version, timestamp, method: method as ConsentMethod, categories: state };
  } catch {
    return null;
  }
}
