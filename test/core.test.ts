import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentManager } from "../src/consent/manager";
import { CONSENT_EVENT } from "../src/consent/types";
import { createBatcher } from "../src/core/batch";
import { createConsentBridge } from "../src/core/consent";
import { parseDsn } from "../src/core/dsn";
import { watchRoutes } from "../src/core/routes";
import { pageUrl, scrub, stripQuery } from "../src/core/scrub";
import { labelFor, selectorFor } from "../src/core/selector";
import { getSessionId, resetSessionId } from "../src/core/session";
import { parseStatus } from "../src/core/status";
import { createTransport } from "../src/core/transport";
import { DSN, ENDPOINT, flushPromises, makeClient, mockBeacon, mockFetch, removeBeacon, useFakeTimers } from "./helpers";

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  removeBeacon();
});

describe("parseDsn", () => {
  it("parses the public DSN form", () => {
    expect(parseDsn(DSN)).toEqual({ endpoint: ENDPOINT, key: "pk_test", projectId: "42" });
  });
  it("allows http only for localhost", () => {
    expect(parseDsn("http://k@localhost:3001/7")?.endpoint).toBe("http://localhost:3001/api/7");
    expect(parseDsn("http://k@127.0.0.1:3001/7")).not.toBeNull();
    expect(parseDsn("http://k@get.trapp.build/7")).toBeNull();
  });
  it.each(["", "nope", "https://get.trapp.build/42", "https://k@get.trapp.build/", "https://k@get.trapp.build/a/b", "https://k@get.trapp.build/42?x=1", "ftp://k@h/1"])(
    "rejects %j",
    (dsn) => expect(parseDsn(dsn)).toBeNull(),
  );
});

describe("scrub", () => {
  it("removes e-mails, tokens, cards, phones and secrets in query strings", () => {
    const out = scrub("user john.doe@example.com Bearer abcdefgh12345 card 4111 1111 1111 1111 call +7 (916) 123-45-67 token=abc123&x=1");
    expect(out).not.toMatch(/john|abcdefgh|4111|916|abc123/);
    expect(out).toContain("[email]");
    expect(out).toContain("Bearer [filtered]");
    expect(out).toContain("token=[filtered]");
    expect(out).toContain("[phone]");
  });
  it("strips query and hash", () => {
    expect(stripQuery("https://a.test/p?token=1#h")).toBe("https://a.test/p");
    expect(pageUrl()).toBe(location.origin + location.pathname);
  });
});

describe("session", () => {
  it("is 16 hex chars and persists in sessionStorage", () => {
    resetSessionId();
    const id = getSessionId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(sessionStorage.getItem("trapp_session")).toBe(id);
    resetSessionId();
    expect(getSessionId()).toBe(id);
  });
});

describe("selector", () => {
  it("builds a structural selector of at most 5 levels without text", () => {
    document.body.innerHTML = `<main><section></section><section><div><ul><li><a href="/x" class="cta big extra">Start <b>free</b> now</a></li></ul></div></section></main>`;
    const a = document.querySelector("a")!;
    const selector = selectorFor(a);
    expect(selector).toBe("section:nth-of-type(2) > div > ul > li > a.cta.big");
    expect(selector.split(" > ").length).toBeLessThanOrEqual(5);
    expect(selector).not.toContain("Start");
  });
  it("stops at an id", () => {
    document.body.innerHTML = `<div id="app"><p><span></span></p></div>`;
    expect(selectorFor(document.querySelector("span"))).toBe("div#app > p > span");
  });
  it("labels only links and buttons, scrubbed and cut to 40 chars", () => {
    document.body.innerHTML = `<button>Send to john@example.com ${"x".repeat(60)}</button><p>No label here</p>`;
    const label = labelFor(document.querySelector("button"))!;
    expect(label.length).toBeLessThanOrEqual(40);
    expect(label).toContain("[email]");
    expect(labelFor(document.querySelector("p"))).toBeUndefined();
  });
});

describe("parseStatus", () => {
  it("keeps only known, allowlisted fields and clamps interval", () => {
    const s = parseStatus({
      mode: "warning",
      warning: { text: "x", tone: "pink", shape: "<img>", position: "left", dismissible: "yes", onclick: "evil" },
      lockdown: {},
      maintenanceUrl: "https://maintenance.trapp.build/o/a",
      collection: { errors: true, metrika: "no", recordings: false },
      recordings: { sampleRate: 7, onError: false, maskText: true },
      interval: 5,
      evil: { __proto__: { x: 1 } },
    })!;
    expect(s).toEqual({
      mode: "warning",
      warning: { text: "x", tone: "amber", shape: "bar", position: "top", dismissible: false },
      maintenanceUrl: "https://maintenance.trapp.build/o/a",
      collection: { errors: true, metrika: undefined, recordings: false },
      recordings: { sampleRate: 1, onError: false, maskText: true },
      interval: 30,
    });
    expect(parseStatus({ interval: 10_000 })!.interval).toBe(600);
    expect(parseStatus({})!.interval).toBe(60);
    expect(parseStatus({ mode: "evil" })!.mode).toBeNull();
    expect(parseStatus("nope")).toBeNull();
  });
});

describe("consent bridge", () => {
  it("reads the cookie, follows the window event and ignores prototype tricks", () => {
    document.cookie = `trapp_consent=${encodeURIComponent(JSON.stringify({ categories: { statistics: true } }))}; path=/`;
    const bridge = createConsentBridge(undefined);
    expect(bridge.granted()).toBe(true);
    const stop = bridge.start();
    const seen: boolean[] = [];
    bridge.subscribe((g) => seen.push(g));
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { categories: { statistics: false } } }));
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { categories: Object.create({ statistics: true }) } }));
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: null }));
    expect(seen).toEqual([false]);
    stop();
    document.cookie = "trapp_consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });
  it("accepts a manual object, a boolean and a ConsentManager", () => {
    const bridge = createConsentBridge({ statistics: true });
    expect(bridge.granted()).toBe(true);
    bridge.set(false);
    expect(bridge.granted()).toBe(false);
    const manager = new ConsentManager();
    bridge.set(manager);
    expect(bridge.granted()).toBe(false);
    manager.save({ statistics: true });
    expect(bridge.granted()).toBe(true);
    // A manual source wins over the window event.
    const stop = bridge.start();
    bridge.set({ statistics: false });
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: { categories: { statistics: true } } }));
    expect(bridge.granted()).toBe(false);
    stop();
  });
});

describe("transport", () => {
  it("posts text/plain JSON without credentials and includes the key", async () => {
    const { sent } = mockFetch();
    const t = createTransport(parseDsn(DSN)!);
    expect(await t.send("hit", "{}")).toBe(202);
    expect(sent[0].url.href).toBe(`${ENDPOINT}/hit?key=pk_test`);
    expect(sent[0].init.credentials).toBe("omit");
    expect((sent[0].init.headers as Record<string, string>)["Content-Type"]).toBe("text/plain;charset=UTF-8");
    expect(t.url("replay", { session: "a", seq: 2 })).toBe(`${ENDPOINT}/replay?key=pk_test&session=a&seq=2`);
  });

  it("honours Retry-After (capped at one hour) and resumes afterwards", async () => {
    useFakeTimers();
    const { fn } = mockFetch(() => new Response(null, { status: 429, headers: { "Retry-After": "99999" } }));
    const t = createTransport(parseDsn(DSN)!);
    expect(await t.send("errors", "{}")).toBe(429);
    expect(await t.send("errors", "{}")).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3_600_000 - 1);
    expect(await t.send("errors", "{}")).toBe(0);
    vi.advanceTimersByTime(2);
    await t.send("errors", "{}");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("uses sendBeacon when asked and falls back to fetch without it", async () => {
    const { sent } = mockFetch();
    const beacon = mockBeacon();
    const t = createTransport(parseDsn(DSN)!);
    await t.send("hit", "{}", { beacon: true });
    expect(beacon.fn).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
    removeBeacon();
    await t.send("hit", "{}", { beacon: true });
    expect(sent).toHaveLength(1);
  });

  it("never beacons a gzipped body: it would lose Content-Encoding", async () => {
    const beacon = mockBeacon();
    const calls: { headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      calls.push(init);
      return new Response(null, { status: 202 });
    }));
    const t = createTransport(parseDsn("https://k@get.example.com/1")!);
    await t.send("errors", new Uint8Array([31, 139, 8]), { beacon: true });
    expect(beacon.fn).not.toHaveBeenCalled();
    expect(calls[0].headers["Content-Encoding"]).toBe("gzip");
  });

  it("falls back to fetch when sendBeacon is missing", async () => {
    vi.stubGlobal("navigator", {});
    const fetchFn = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchFn);
    const t = createTransport(parseDsn("https://k@get.example.com/1")!);
    await t.send("hit", "{}", { beacon: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("batches by count or time, caps at 100, gzips large bodies and flushes on pagehide with a beacon", async () => {
    useFakeTimers();
    const { sent } = mockFetch();
    const beacon = mockBeacon();
    const t = createTransport(parseDsn(DSN)!);
    const batch = createBatcher<number>(t, { path: "errors", every: 5000, max: 20, serialize: (items) => JSON.stringify({ items, pad: "x".repeat(2000) }) });
    for (let i = 0; i < 150; i++) batch.push(i);
    expect(batch.pending()).toHaveLength(10); // 7 batches of 20 flushed on the way
    await flushPromises();
    expect(sent).toHaveLength(7);
    expect((sent[0].init.headers as Record<string, string>)["Content-Encoding"]).toBe("gzip");
    expect((sent[0].json() as { items: number[] }).items).toHaveLength(20);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(sent).toHaveLength(8);
    const slow = createBatcher<number>(t, { path: "interactions", every: 5000, max: 1000, serialize: JSON.stringify });
    for (let i = 0; i < 150; i++) slow.push(i);
    expect(slow.pending()).toHaveLength(100); // the 100-event cap drops the rest
    batch.push(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(beacon.fn).toHaveBeenCalledTimes(2); // both batchers
    expect(batch.pending()).toHaveLength(0);
    expect(slow.pending()).toHaveLength(0);
  });
});

describe("client", () => {
  it("starts once, tears modules down on the last stop and forwards helpers", () => {
    mockFetch();
    const setup = vi.fn(() => teardown);
    const teardown = vi.fn();
    const client = makeClient([{ name: "m", setup }]);
    const stop1 = client.start();
    const stop2 = client.start();
    expect(setup).toHaveBeenCalledTimes(1);
    stop1();
    expect(teardown).not.toHaveBeenCalled();
    stop2();
    stop2();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing module", () => {
    mockFetch();
    const after = vi.fn();
    const client = makeClient([
      { name: "bad", setup: () => { throw new Error("boom"); } },
      { name: "good", setup: after },
    ]);
    expect(() => client.start()).not.toThrow();
    expect(after).toHaveBeenCalled();
  });

  it("applies setUser only with statistics consent and caps tags at 30", () => {
    mockFetch();
    const client = makeClient([], { consent: false });
    client.setUser({ id: "u1" });
    expect(client.user).toBeNull();
    client.setConsent({ statistics: true });
    client.setUser({ id: "u1" });
    expect(client.user).toEqual({ id: "u1" });
    for (let i = 0; i < 40; i++) client.setTag(`t${i}`, "v");
    expect(Object.keys(client.tags)).toHaveLength(30);
  });

  it("is inert without a valid DSN", () => {
    const client = makeClient([{ name: "m", setup: vi.fn() }], { dsn: "nope" });
    expect(client.transport).toBeNull();
    client.start();
    expect(client.options.modules![0].setup).not.toHaveBeenCalled();
  });
});

describe("watchRoutes", () => {
  it("patches history once, preserves the originals and reports path changes", () => {
    const original = history.pushState;
    const seen: string[] = [];
    const stop = watchRoutes((path) => seen.push(path));
    history.pushState({}, "", "/a?x=1");
    history.replaceState({}, "", "/b");
    history.pushState({}, "", "/b#h");
    expect(seen).toEqual(["/a", "/b"]);
    expect(location.pathname).toBe("/b");
    stop();
    history.pushState({}, "", "/");
    expect(seen).toHaveLength(2);
    // The wrapper calls the browser's implementation; it is not replaced again.
    expect(history.pushState).not.toBe(original);
    const again = history.pushState;
    watchRoutes(() => {})();
    expect(history.pushState).toBe(again);
  });
});
