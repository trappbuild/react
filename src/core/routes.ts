import { safe } from "./env.js";

type RouteListener = (path: string, previous: string) => void;

const listeners = new Set<RouteListener>();
let patched = false;
let current = "";

function announce() {
  const path = location.pathname;
  if (path === current) return;
  const previous = current;
  current = path;
  listeners.forEach((l) => safe(() => l(path, previous)));
}

/** Wraps a history method, keeping the original (and any earlier wrapper) intact. */
function patch(method: "pushState" | "replaceState") {
  const original = history[method];
  history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
    const result = original.apply(this, args);
    safe(announce);
    return result;
  };
}

/**
 * SPA route changes: `pushState`/`replaceState` are patched once (originals preserved) and
 * `popstate` is observed. Shared by metrika, breadcrumbs and recordings.
 */
export function watchRoutes(listener: RouteListener): () => void {
  if (typeof window === "undefined") return () => {};
  if (!patched) {
    patched = true;
    current = location.pathname;
    safe(() => {
      patch("pushState");
      patch("replaceState");
    });
    window.addEventListener("popstate", () => safe(announce));
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
