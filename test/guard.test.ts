import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import source from "../src/guard/guard.js?raw";
import { mockLocation, useFakeTimers } from "./helpers";
const STUB = "https://maintenance.trapp.build/org/app";
let loc: ReturnType<typeof mockLocation>;

/** Runs the snippet as an inline <script data-url data-timeout> would. */
function runGuard(attrs: Record<string, string> = {}) {
  const script = document.createElement("script");
  for (const [k, v] of Object.entries(attrs)) script.setAttribute(k, v);
  document.head.append(script);
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
  new Function(source)();
  Object.defineProperty(document, "currentScript", { value: null, configurable: true });
}

const fail = () => {
  const el = document.createElement("script");
  el.src = "https://site.test/assets/index-abc.js";
  document.head.append(el);
  el.dispatchEvent(new Event("error"));
};

beforeEach(() => {
  sessionStorage.clear();
  delete window.__trapp;
  loc = mockLocation();
  useFakeTimers();
});
afterEach(() => {
  loc.restore();
  vi.useRealTimers();
});

describe("guard snippet", () => {
  it("buffers early errors and rejections for the SDK (at most 50)", () => {
    runGuard({ "data-url": STUB });
    const error = new Error("early");
    window.dispatchEvent(new ErrorEvent("error", { error, message: "early", filename: "a.js", lineno: 3, colno: 4 }));
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise: Promise.resolve(), reason: new Error("rej") }));
    fail();
    for (let i = 0; i < 60; i++) window.dispatchEvent(new ErrorEvent("error", { message: `n${i}` }));
    const buffer = window.__trapp!.buffer!;
    expect(buffer).toHaveLength(50);
    expect(buffer[0]).toMatchObject({ type: "error", message: "early", stack: error.stack, filename: "a.js", lineno: 3, colno: 4 });
    expect(buffer[1]).toMatchObject({ type: "rejection", message: "rej" });
    expect(buffer[2]).toMatchObject({ type: "resource", url: "https://site.test/assets/index-abc.js" });
    expect(typeof window.__trapp!.ready).toBe("function");
  });

  it("redirects only when an asset failed and ready() was not called within the timeout", () => {
    runGuard({ "data-url": STUB, "data-timeout": "1000" });
    vi.advanceTimersByTime(1000);
    expect(loc.replace).not.toHaveBeenCalled(); // no failure

    runGuard({ "data-url": STUB, "data-timeout": "1000" });
    fail();
    window.__trapp!.ready!();
    vi.advanceTimersByTime(1000);
    expect(loc.replace).not.toHaveBeenCalled(); // app came up anyway

    runGuard({ "data-url": STUB, "data-timeout": "1000" });
    fail();
    vi.advanceTimersByTime(1000);
    expect(loc.replace).toHaveBeenCalledWith(`${STUB}?reason=error&from=${encodeURIComponent(location.origin + "/")}`);
    expect(Number(sessionStorage.getItem("trapp_crash"))).toBeGreaterThan(0);
  });

  it("treats chunk-load errors as a failed start and defaults to 15 s", () => {
    runGuard({ "data-url": STUB });
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise: Promise.resolve(), reason: new TypeError("Failed to fetch dynamically imported module: /x.js") }));
    vi.advanceTimersByTime(14_999);
    expect(loc.replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(loc.replace).toHaveBeenCalledTimes(1);
  });

  it("does not loop: not within 5 minutes of a crash redirect, not on ?trapp_retry=1, not without an https url", () => {
    sessionStorage.setItem("trapp_crash", String(Date.now()));
    runGuard({ "data-url": STUB, "data-timeout": "10" });
    fail();
    vi.advanceTimersByTime(10);
    expect(loc.replace).not.toHaveBeenCalled();

    sessionStorage.clear();
    loc.restore();
    loc = mockLocation({ search: "?trapp_retry=1" });
    runGuard({ "data-url": STUB, "data-timeout": "10" });
    fail();
    vi.advanceTimersByTime(10);
    expect(loc.replace).not.toHaveBeenCalled();

    loc.restore();
    loc = mockLocation();
    runGuard({ "data-url": "javascript:alert(1)", "data-timeout": "10" });
    runGuard({ "data-url": "http://maintenance.trapp.build/o/a", "data-timeout": "10" });
    runGuard({ "data-timeout": "10" });
    fail();
    vi.advanceTimersByTime(10);
    expect(loc.replace).not.toHaveBeenCalled();
    expect(window.__trapp!.buffer!.length).toBeGreaterThan(0); // buffering still works without a url
  });
});
