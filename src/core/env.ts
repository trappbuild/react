// Tiny shared helpers. Everything here must stay side-effect free and bundler-agnostic.

const TAG = "[trapp]";

/** True outside production builds. `process` only exists when a bundler injects it. */
export function isDev(): boolean {
  try {
    return typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
  } catch {
    return false;
  }
}

/** Development-only warning: silent in production builds and in the CDN bundle. */
export function devWarn(message: string, ...rest: unknown[]) {
  if (isDev()) console.warn(`${TAG} ${message}`, ...rest);
}

/** Always-on warning for things an operator must see (rejected redirect, invalid DSN). */
export function warn(message: string, ...rest: unknown[]) {
  console.warn(`${TAG} ${message}`, ...rest);
}

/** Runs `fn` and swallows anything it throws: an SDK bug must never break the host page. */
export function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    devWarn("suppressed", error);
    return undefined;
  }
}

export const isBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function hex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(buffer);
  else for (let i = 0; i < bytes; i++) buffer[i] = Math.floor(Math.random() * 256);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}
