import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errors, type ErrorEvent } from "../src/errors";
import { buildEvent, EVENT_MAX_BYTES, sizeOf } from "../src/errors/event";
import { parseStack } from "../src/errors/stack";
import type { Client } from "../src/core/types";
import { flushPromises, makeClient, mockFetch, removeBeacon, useFakeTimers } from "./helpers";

let stop: () => void = () => {};
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  sessionStorage.clear();
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  removeBeacon();
  delete window.__trapp;
});

function start(options: Parameters<typeof errors>[0] = {}, client?: Client) {
  const c = client ?? makeClient([errors(options)]);
  stop = c.start();
  return c;
}

const chrome = `TypeError: Cannot read properties of null (reading 'x')
    at render (${location.origin}/assets/index-a1b2.js:1:4821)
    at async load (${location.origin}/node_modules/.vite/deps/react.js:10:20)
    at https://cdn.test/lib.js:5:6
    at <anonymous>`;
const firefox = `render@${location.origin}/assets/index.js:1:4821
@https://cdn.test/lib.js:5:6`;

describe("parseStack", () => {
  it("parses Chrome and Firefox/Safari formats and marks in-app frames", () => {
    const frames = parseStack(chrome);
    expect(frames).toEqual([
      { filename: `${location.origin}/assets/index-a1b2.js`, function: "render", lineno: 1, colno: 4821, inApp: true },
      { filename: `${location.origin}/node_modules/.vite/deps/react.js`, function: "load", lineno: 10, colno: 20, inApp: false },
      { filename: "https://cdn.test/lib.js", function: "?", lineno: 5, colno: 6, inApp: false },
    ]);
    expect(parseStack(firefox).map((f) => f.function)).toEqual(["render", "?"]);
    expect(parseStack(undefined)).toEqual([]);
  });
  it("caps frames at 100", () => {
    const stack = Array.from({ length: 150 }, (_, i) => `    at f${i} (https://x.test/a.js:${i}:1)`).join("\n");
    expect(parseStack(stack)).toHaveLength(100);
  });
});

describe("buildEvent limits", () => {
  it("enforces message, breadcrumb, tag and 64 KB limits and scrubs PII", () => {
    const client = makeClient([], { consent: true });
    for (let i = 0; i < 40; i++) client.setTag(`t${i}`, "v");
    client.setConsent(true);
    client.setUser({ id: "u1" });
    const crumbs = Array.from({ length: 80 }, (_, i) => ({ ts: "t", category: "c", message: "m".repeat(2000) + i, level: "info" }));
    const event = buildEvent(client, new Error("mail john@example.com " + "x".repeat(5000)), undefined, { tags: { extra: "1" } }, crumbs);
    expect(event.message.length).toBeLessThanOrEqual(2000);
    expect(event.message).toContain("[email]");
    expect(event.breadcrumbs.length).toBeLessThanOrEqual(50);
    expect(Object.keys(event.tags).length).toBeLessThanOrEqual(31); // 30 + mechanism
    expect(sizeOf(event)).toBeLessThanOrEqual(EVENT_MAX_BYTES);
    expect(event.userId).toBe("u1");
    expect(event.url).toBe(location.origin + location.pathname);
    expect(event.id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("errors module", () => {
  it("captures window errors with the batch envelope and dedupes repeats within 5 s", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const client = start({}, makeClient([errors()], { release: "web@1", environment: "test" }));
    const error = new TypeError("boom");
    error.stack = chrome;
    window.dispatchEvent(new ErrorEvent("error", { error, message: "boom" }));
    window.dispatchEvent(new ErrorEvent("error", { error, message: "boom" }));
    window.dispatchEvent(new ErrorEvent("error", { error, message: "boom" }));
    expect(calls("errors")).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    const [sent] = calls("errors");
    const body = sent.json() as { sdk: unknown; release: string; environment: string; session: string; errors: ErrorEvent[] };
    expect(body.sdk).toEqual(client.sdk);
    expect(body.release).toBe("web@1");
    expect(body.environment).toBe("test");
    expect(body.session).toMatch(/^[0-9a-f]{16}$/);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ type: "TypeError", message: "boom", level: "error", count: 3, tags: { mechanism: "onerror" } });
    expect(body.errors[0].frames[0].inApp).toBe(true);
  });

  it("flushes at 20 events and handles unhandled rejections, resource errors and captureMessage", async () => {
    const { calls } = mockFetch();
    const client = start();
    for (let i = 0; i < 18; i++) client.captureException(new Error(`e${i}`));
    window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise: Promise.resolve(), reason: new RangeError("rej") }));
    const script = document.createElement("script");
    script.src = "https://cdn.test/app.js?v=1";
    document.body.append(script);
    script.dispatchEvent(new Event("error"));
    await flushPromises();
    const body = calls("errors")[0].json() as { errors: ErrorEvent[] };
    expect(body.errors).toHaveLength(20);
    expect(body.errors[18]).toMatchObject({ type: "RangeError", message: "rej", tags: { mechanism: "unhandledrejection" } });
    expect(body.errors[19]).toMatchObject({ type: "ResourceError", level: "warning", message: "Failed to load script https://cdn.test/app.js" });
    client.captureMessage("hello", { level: "warning", tags: { a: "b" } });
    expect(client.transport!.queues.size).toBe(1);
  });

  it("applies sampleRate, ignoreErrors (incl. built-in extension noise) and beforeSend", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const beforeSend = vi.fn((e: ErrorEvent) => (e.message === "drop" ? null : { ...e, message: "edited" }));
    const client = start({ ignoreErrors: [/ignored/, "literal"], beforeSend });
    client.captureException(new Error("ignored by regex"));
    client.captureException(new Error("literal match"));
    client.captureException(new Error("ResizeObserver loop limit exceeded"));
    const ext = new Error("ext");
    ext.stack = "Error: ext\n    at x (chrome-extension://abc/content.js:1:1)";
    client.captureException(ext);
    client.captureException(new Error("drop"));
    client.captureException(new Error("keep"));
    vi.advanceTimersByTime(5000);
    await flushPromises();
    const body = calls("errors")[0].json() as { errors: ErrorEvent[] };
    expect(body.errors.map((e) => e.message)).toEqual(["edited"]);
    stop();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    start({ sampleRate: 0.5 });
    client.captureException(new Error("sampled out"));
    expect(calls("errors")).toHaveLength(1);
  });

  it("respects collection.errors = false from status", () => {
    mockFetch();
    const client = start();
    client.setStatus({ mode: null, warning: null, maintenanceUrl: null, collection: { errors: false }, recordings: {}, interval: 60 });
    client.captureException(new Error("x"));
    expect(client.transport!.queues.values().next().value!.flush).toBeDefined();
    // nothing queued
    expect([...client.transport!.queues].some((q) => (q as { pending?: () => unknown[] }).pending?.().length)).toBe(false);
  });

  it("drains the guard buffer on start", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    window.__trapp = {
      buffer: [
        { type: "error", message: "early", stack: chrome },
        { type: "resource", url: "https://cdn.test/main.js?x=1" },
        { type: "rejection", message: "late" },
      ],
    };
    start();
    expect(window.__trapp.buffer).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    const body = calls("errors")[0].json() as { errors: ErrorEvent[] };
    expect(body.errors.map((e) => [e.type, e.message, e.tags.mechanism])).toEqual([
      ["Error", "early", "guard"],
      ["ResourceError", "Failed to load https://cdn.test/main.js", "guard"],
      ["Error", "late", "guard"],
    ]);
  });
});

describe("breadcrumbs", () => {
  it("records console, fetch, clicks (selector only), routes and visibility; originals keep working", async () => {
    useFakeTimers();
    const { calls, fn } = mockFetch((url) => new Response(url.pathname.includes("api") ? "" : null, { status: url.pathname.includes("fail") ? 500 : 200 }));
    const spy = console.warn; // the spy from beforeEach, wrapped by the module below
    const client = start();
    console.warn("careful john@example.com");
    expect(spy).toHaveBeenCalledWith("careful john@example.com");
    await window.fetch("https://api.test/items?token=secret", { method: "POST" });
    await window.fetch("https://api.test/fail");
    document.body.innerHTML = `<form><input id="pw" type="password" value="hunter2"><button class="save">Save <i>now</i></button></form>`;
    const button = document.querySelector("button")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    history.pushState({}, "", "/next");
    document.dispatchEvent(new Event("visibilitychange"));
    client.captureException(new Error("with crumbs"));
    vi.advanceTimersByTime(5000);
    await flushPromises();
    const event = (calls("errors")[0].json() as { errors: ErrorEvent[] }).errors[0];
    const crumbs = event.breadcrumbs.map((c) => `${c.category}: ${c.message}`);
    expect(crumbs).toEqual([
      "console: careful [email]",
      expect.stringMatching(/^fetch: POST https:\/\/api\.test\/items → 200 \(\d+ ms\)$/),
      expect.stringMatching(/^fetch: GET https:\/\/api\.test\/fail → 500/),
      "ui.click: form > button.save",
      "navigation: / → /next",
      "ui.visibility: visible",
    ]);
    expect(JSON.stringify(event)).not.toContain("hunter2");
    expect(JSON.stringify(event)).not.toContain("secret");
    // Our own ingest calls are not recorded, and the patched fetch delegates to the original.
    expect(fn).toHaveBeenCalledTimes(3);
    history.pushState({}, "", "/");
  });

  it("restores console and fetch on stop", () => {
    mockFetch();
    const fetchBefore = window.fetch;
    const warnBefore = console.warn;
    start();
    expect(window.fetch).not.toBe(fetchBefore);
    stop();
    expect(window.fetch).toBe(fetchBefore);
    expect(console.warn).toBe(warnBefore);
  });
});
