import { safe, truncate } from "../core/env.js";
import { watchRoutes } from "../core/routes.js";
import { scrub, stripQuery } from "../core/scrub.js";
import { selectorFor } from "../core/selector.js";
import type { Breadcrumb, Client } from "../core/types.js";

export const MAX_BREADCRUMBS = 50;
const MESSAGE_MAX = 500;

const crumb = (category: string, message: string, level = "info"): Breadcrumb => ({
  ts: new Date().toISOString(),
  category,
  message: truncate(scrub(message), MESSAGE_MAX),
  level,
});

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return truncate(JSON.stringify(value) ?? String(value), 200);
  } catch {
    return String(value);
  }
}

export interface BreadcrumbOptions {
  console: boolean;
  network: boolean;
}

/**
 * Keeps the last 50 breadcrumbs: console errors/warnings, fetch/XHR (method, URL without query,
 * status, duration), clicks (selector only), route changes and tab visibility. Input values are
 * never read. Every hook keeps the original function and calls it unchanged.
 */
export function startBreadcrumbs(client: Client, options: BreadcrumbOptions) {
  const buffer: Breadcrumb[] = [];
  const add = (c: Breadcrumb) => {
    buffer.push(c);
    if (buffer.length > MAX_BREADCRUMBS) buffer.shift();
  };
  const own = client.dsn?.endpoint ?? "\u0000";
  const stops: (() => void)[] = [client.on("breadcrumb", add)];

  if (options.console) {
    for (const level of ["error", "warn"] as const) {
      const original = console[level];
      console[level] = function (this: Console, ...args: unknown[]) {
        safe(() => add(crumb("console", args.map(describe).join(" "), level === "warn" ? "warning" : "error")));
        return original.apply(this, args);
      };
      stops.push(() => {
        console[level] = original;
      });
    }
  }

  if (options.network && typeof fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const started = Date.now();
      const url = stripQuery(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const promise = originalFetch.call(this, input, init);
      if (!url.startsWith(own)) {
        promise.then(
          (res) => add(crumb("fetch", `${method} ${url} → ${res.status} (${Date.now() - started} ms)`, res.ok ? "info" : "error")),
          () => add(crumb("fetch", `${method} ${url} → failed (${Date.now() - started} ms)`, "error")),
        );
      }
      return promise;
    };
    stops.push(() => {
      window.fetch = originalFetch;
    });

    if (typeof XMLHttpRequest !== "undefined") {
      const proto = XMLHttpRequest.prototype;
      const open = proto.open;
      const send = proto.send;
      type Tracked = XMLHttpRequest & { __trapp?: { method: string; url: string; started: number } };
      proto.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
        safe(() => {
          this.__trapp = { method: method.toUpperCase(), url: stripQuery(String(url)), started: 0 };
        });
        return (open as (...a: unknown[]) => void).apply(this, [method, url, ...rest]);
      } as typeof proto.open;
      proto.send = function (this: Tracked, body?: Document | XMLHttpRequestBodyInit | null) {
        const info = this.__trapp;
        if (info && !info.url.startsWith(own)) {
          info.started = Date.now();
          this.addEventListener("loadend", () =>
            add(crumb("xhr", `${info.method} ${info.url} → ${this.status} (${Date.now() - info.started} ms)`, this.status >= 400 || this.status === 0 ? "error" : "info")),
          );
        }
        return send.call(this, body);
      };
      stops.push(() => {
        proto.open = open;
        proto.send = send;
      });
    }
  }

  const onClick = (event: Event) => add(crumb("ui.click", selectorFor(event.target as Element)));
  document.addEventListener("click", onClick, true);
  stops.push(() => document.removeEventListener("click", onClick, true));

  stops.push(watchRoutes((path, previous) => add(crumb("navigation", `${previous} → ${path}`))));

  const onVisibility = () => add(crumb("ui.visibility", document.visibilityState));
  document.addEventListener("visibilitychange", onVisibility);
  stops.push(() => document.removeEventListener("visibilitychange", onVisibility));

  return {
    snapshot: (): Breadcrumb[] => buffer.slice(),
    stop: () => stops.forEach((s) => safe(s)),
  };
}
