import type { Client } from "../core/types.js";
import { allowedMaintenanceUrl, redirectTo } from "./lockdown.js";

const CRASH_KEY = "trapp_crash";
const LOOP_WINDOW_MS = 5 * 60_000;
export const RECOVERY_MS = 10_000;

/** A `?trapp_retry=1` visit (the stub's "Retry" button) disables crash redirects once. */
export function isRetryVisit(): boolean {
  return /[?&]trapp_retry=1(?:&|$)/.test(location.search);
}

/** True when a crash redirect happened within the last 5 minutes — a second one would loop. */
export function recentlyRedirected(): boolean {
  try {
    const last = Number(sessionStorage.getItem(CRASH_KEY));
    return last > 0 && Date.now() - last < LOOP_WINDOW_MS;
  } catch {
    return false;
  }
}

function markRedirected() {
  try {
    sessionStorage.setItem(CRASH_KEY, String(Date.now()));
  } catch {
    /* private mode */
  }
}

/**
 * Sends the visitor to the stub with `?reason=error` if every guard passes. Returns whether
 * a redirect was issued. The `fatal` event is queued first and flushed with a beacon.
 */
export function crashRedirect(client: Client, fallbackUrl: string | undefined, extraOrigin: string | undefined): boolean {
  if (isRetryVisit() || recentlyRedirected()) return false;
  const url = allowedMaintenanceUrl(client.status?.maintenanceUrl ?? fallbackUrl, extraOrigin);
  if (!url) return false;
  markRedirected();
  client.captureMessage("Crash: visitor redirected to the maintenance page", {
    level: "fatal",
    tags: { crash_redirect: "1" },
    mechanism: "crash",
  });
  client.transport?.flush(true);
  redirectTo(url, { reason: "error", from: location.origin + location.pathname });
  return true;
}

/**
 * Watches root-boundary crashes: a crash not recovered within 10 s redirects.
 * Returns a stop function.
 */
export function watchCrashes(client: Client, fallbackUrl: string | undefined, extraOrigin: string | undefined) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = client.on("crash", ({ recovered }) => {
    clearTimeout(timer);
    timer = undefined;
    if (!recovered) timer = setTimeout(() => crashRedirect(client, fallbackUrl, extraOrigin), RECOVERY_MS);
  });
  return () => {
    clearTimeout(timer);
    off();
  };
}
