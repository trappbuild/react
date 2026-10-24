import { warn } from "../core/env.js";

export const MAINTENANCE_ORIGIN = "https://maintenance.trapp.build";

/**
 * The only places a visitor may be sent: our stub, or the origin the client configured.
 * Anything else — a tampered status response, a typo — is logged and ignored.
 */
export function allowedMaintenanceUrl(url: string | null | undefined, extraOrigin?: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if ((parsed.origin !== MAINTENANCE_ORIGIN && parsed.origin !== extraOrigin) || parsed.protocol !== "https:" || parsed.username) throw 0;
    return parsed.href;
  } catch {
    warn("maintenanceUrl rejected", url);
    return null;
  }
}

/** `location.replace(url?reason=…&from=/path)` — query appended safely whatever the url already has. */
export function redirectTo(url: string, params: Record<string, string>) {
  const target = new URL(url);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  location.replace(target.href);
}
