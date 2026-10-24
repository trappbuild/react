import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metrika } from "../src/metrika";
import { flushPromises, makeClient, mockBeacon, mockFetch, removeBeacon, useFakeTimers } from "./helpers";

let stop: () => void = () => {};
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  history.replaceState({}, "", "/?utm_source=news&utm_campaign=spring&token=secret");
});
afterEach(() => {
  stop();
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.useRealTimers();
  removeBeacon();
});

const hits = (calls: (p: string) => { json: () => unknown }[]) => calls("hit").map((c) => c.json() as Record<string, unknown>);

describe("metrika", () => {
  it("sends nothing before consent, then a pageview of the current page", async () => {
    const { calls } = mockFetch();
    const client = makeClient([metrika()], { consent: false });
    stop = client.start();
    await flushPromises();
    expect(calls("hit")).toHaveLength(0);
    client.setConsent({ statistics: true });
    await flushPromises();
    expect(hits(calls)).toEqual([
      { type: "pageview", path: "/", url: `${location.origin}/`, utm: { source: "news", campaign: "spring" } },
    ]);
    expect(JSON.stringify(hits(calls))).not.toContain("secret");
  });

  it("with requireConsent: false counts the visit right away — cookieless, no consent needed", async () => {
    const { calls } = mockFetch();
    stop = makeClient([metrika({ requireConsent: false })], { consent: false }).start();
    await flushPromises();
    expect(hits(calls)).toEqual([expect.objectContaining({ type: "pageview", path: "/" })]);
  });

  it("reports leave + pageview on route changes and leave with duration on pagehide (beacon)", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const beacon = mockBeacon();
    stop = makeClient([metrika()], { consent: true }).start();
    await flushPromises();
    vi.advanceTimersByTime(3000);
    history.pushState({}, "", "/pricing?plan=pro");
    await flushPromises();
    const sent = hits(calls);
    expect(sent[1]).toMatchObject({ type: "leave", path: "/", durationMs: 3000 });
    expect(sent[2]).toMatchObject({ type: "pageview", path: "/pricing", referrer: `${location.origin}/` });
    expect(sent[2]).not.toHaveProperty("utm");
    window.dispatchEvent(new Event("pagehide"));
    expect(beacon.fn).toHaveBeenCalledTimes(1);
    expect(beacon.calls[0].url).toContain("/api/42/hit?key=pk_test");
  });

  it("counts a leave after 30 s in the background and a new pageview on return", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    stop = makeClient([metrika()], { consent: true }).start();
    await flushPromises();
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(29_000);
    expect(hits(calls)).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(hits(calls)[1]).toMatchObject({ type: "leave", durationMs: 30_000 });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(hits(calls)[2]).toMatchObject({ type: "pageview" });
  });

  it("stops when the project has metrika switched off", async () => {
    const { calls } = mockFetch();
    const client = makeClient([metrika()], { consent: true });
    client.setStatus({ mode: null, warning: null, maintenanceUrl: null, collection: { metrika: false }, recordings: {}, interval: 60 });
    stop = client.start();
    await flushPromises();
    expect(calls("hit")).toHaveLength(0);
  });
});
