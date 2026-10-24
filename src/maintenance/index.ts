import { safe } from "../core/env.js";
import { DEFAULT_INTERVAL, fetchStatus, type StatusSnapshot } from "../core/status.js";
import type { Client, TrappModule } from "../core/types.js";
import { createWarningBanner } from "./banner.js";
import { watchCrashes } from "./crash.js";
import { allowedMaintenanceUrl, redirectTo } from "./lockdown.js";

export interface MaintenanceOptions {
  /** Redirect to the stub when the root error boundary stays in its fallback for 10 s. Default: false. */
  redirectOnCrash?: boolean;
  /** Your own stub origin (`https://status.example.com`), allowed besides `https://maintenance.trapp.build`. */
  maintenanceOrigin?: string;
  /** Stub URL for crash redirects while the status is still unknown (must pass the origin check). */
  maintenanceUrl?: string;
  /** Polling interval in seconds, 30–600. The server's `interval` wins. Default: 60. */
  interval?: number;
}

/**
 * Availability: polls `status` (on load, every 60 s while the tab is visible, at once when it
 * becomes visible), shows the Warning banner, performs the Lockdown redirect to a verified origin,
 * and optionally redirects after an unrecovered crash. Sends nothing about the visitor.
 */
export function maintenance(options: MaintenanceOptions = {}): TrappModule {
  return {
    name: "maintenance",
    setup(client: Client) {
      const transport = client.transport;
      if (!transport) return;
      const extraOrigin = options.maintenanceOrigin ?? client.options.maintenanceOrigin;
      const banner = createWarningBanner();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let seen = "";
      let lastPoll = 0;
      let stopped = false;
      let interval = Math.min(Math.max(options.interval ?? DEFAULT_INTERVAL, 30), 600);

      // Only redraw when something the visitor can see has changed.
      const apply = (status: StatusSnapshot) => {
        const next = JSON.stringify([status.mode, status.warning, status.maintenanceUrl]);
        if (next === seen) return;
        seen = next;
        const url = status.mode === "lockdown" && allowedMaintenanceUrl(status.maintenanceUrl, extraOrigin);
        if (url) {
          banner.hide();
          return redirectTo(url, { from: location.origin + location.pathname });
        }
        if (status.mode === "warning" && status.warning) banner.show(status.warning);
        else banner.hide();
      };

      const schedule = () => {
        clearTimeout(timer);
        if (!stopped && document.visibilityState === "visible") timer = setTimeout(poll, interval * 1000);
      };

      const poll = async () => {
        lastPoll = Date.now();
        const status = await fetchStatus(transport);
        if (stopped) return;
        if (status) {
          interval = status.interval;
          client.setStatus(status);
          safe(() => apply(status));
        }
        schedule();
      };

      const onVisibility = () => {
        // Back in the tab: refresh at once unless we just did.
        if (document.visibilityState === "visible" && Date.now() - lastPoll > 10_000) void poll();
        else schedule();
      };
      document.addEventListener("visibilitychange", onVisibility);
      const stopCrash = options.redirectOnCrash ? watchCrashes(client, options.maintenanceUrl, extraOrigin) : () => {};
      void poll();

      return () => {
        stopped = true;
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
        stopCrash();
        banner.hide();
      };
    },
  };
}

export { allowedMaintenanceUrl, MAINTENANCE_ORIGIN } from "./lockdown.js";
export type { StatusSnapshot, WarningAppearance } from "../core/status.js";
