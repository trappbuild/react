import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusSnapshot } from "../src/core/status";
import { errors } from "../src/errors";
import { recordings, type Interaction } from "../src/recordings";
import { BLOCK_IMAGES_SELECTOR, BLOCK_SELECTOR, weakDevice } from "../src/recordings/replay";
import type { RrwebEvent, RrwebModule, RrwebRecordOptions } from "../src/recordings/rrweb";
import { flushPromises, makeClient, mockBeacon, mockFetch, removeBeacon, useFakeTimers } from "./helpers";

let stop: () => void = () => {};
const enabled: StatusSnapshot = { mode: null, warning: null, maintenanceUrl: null, collection: { recordings: true }, recordings: {}, interval: 60 };

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  document.body.innerHTML = "";
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  removeBeacon();
  history.replaceState({}, "", "/");
});

const click = (el: Element, x = 10, y = 20) => {
  const e = new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(e, "pageX", { value: x });
  Object.defineProperty(e, "pageY", { value: y });
  el.dispatchEvent(e);
};

function sentEvents(calls: (p: string) => { json: () => unknown }[]): Interaction[] {
  return calls("interactions").flatMap((c) => (c.json() as { events: Interaction[] }).events);
}

describe("interactions", () => {
  it("sends clicks with selector, label (links/buttons only), position and viewport in the contract envelope", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    document.body.innerHTML = `<main><button class="cta">Buy now for john@example.com please and more text here</button><div class="box">plain</div></main>`;
    const client = makeClient([recordings()], { consent: true });
    stop = client.start();
    click(document.querySelector("button")!);
    click(document.querySelector(".box")!, 30, 40);
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    const body = calls("interactions")[0].json() as { sdk: unknown; session: string; events: Interaction[] };
    expect(body.sdk).toEqual(client.sdk);
    expect(body.session).toBe(client.sessionId);
    expect(body.events[0]).toMatchObject({ kind: "click", path: "/", selector: "main > button.cta", vw: window.innerWidth, vh: window.innerHeight });
    expect(body.events[0].label!.length).toBeLessThanOrEqual(40);
    expect(body.events[0].label).toContain("[email]");
    expect(body.events[1].label).toBeUndefined();
    expect(body.events[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("detects rage (3 clicks in 1 s, count grows) and dead clicks (nothing changed in 500 ms)", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    document.body.innerHTML = `<div id="dead">x</div><button id="live" onclick="">y</button>`;
    const client = makeClient([recordings()], { consent: true });
    const rage = vi.fn();
    client.on("rage", rage);
    stop = client.start();
    click(document.getElementById("live")!);
    document.getElementById("live")!.textContent = "changed"; // a reaction → not dead
    await vi.advanceTimersByTimeAsync(600);
    const dead = document.getElementById("dead")!;
    click(dead);
    click(dead);
    click(dead);
    click(dead);
    expect(rage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    const events = sentEvents(calls);
    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "rage")).toHaveLength(1);
    expect(events.find((e) => e.kind === "rage")!.count).toBe(4);
    expect(events.filter((e) => e.kind === "dead").map((e) => e.selector)).toEqual(["div#dead", "div#dead", "div#dead", "div#dead"]);
  });

  it("records form steps without values, skips password/cc fields, and scroll depth per page", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    document.body.innerHTML = `<form id="signup"><input name="email" value="a@b.c"><input type="password" name="pw" value="s3cret"><input autocomplete="cc-number" name="card" value="4111"></form>`;
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, configurable: true });
    stop = makeClient([recordings()], { consent: true }).start();
    const [email, pw, card] = Array.from(document.querySelectorAll("input"));
    for (const el of [email, pw, card]) {
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }
    document.getElementById("signup")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    history.pushState({}, "", "/next");
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    const events = sentEvents(calls);
    expect(events.filter((e) => e.kind === "form")).toEqual([
      expect.objectContaining({ selector: "form#signup", field: "email", step: "focus" }),
      expect.objectContaining({ selector: "form#signup", field: "email", step: "blur" }),
      expect.objectContaining({ selector: "form#signup", step: "submit" }),
    ]);
    const scroll = events.find((e) => e.kind === "scroll")!;
    expect(scroll).toMatchObject({ path: "/", depth: Math.round(((500 + window.innerHeight) / 2000) * 100) });
    const json = JSON.stringify(events);
    expect(json).not.toMatch(/a@b\.c|s3cret|4111|"pw"|"card"/);
  });

  it("is gated by consent and the project switch, flushes at 50 events and on pagehide", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const beacon = mockBeacon();
    document.body.innerHTML = `<button>b</button>`;
    const client = makeClient([recordings()], { consent: false });
    stop = client.start();
    const button = document.querySelector("button")!;
    click(button);
    vi.advanceTimersByTime(10_000);
    expect(calls("interactions")).toHaveLength(0);
    client.setConsent(true);
    for (let i = 0; i < 50; i++) click(button); // 50 clicks + 1 rage = 51 events
    await flushPromises();
    expect(calls("interactions")).toHaveLength(1);
    expect((calls("interactions")[0].json() as { events: unknown[] }).events).toHaveLength(50);
    client.setStatus({ ...enabled, collection: { recordings: false } });
    for (let i = 0; i < 60; i++) click(button); // gated off: nothing queued
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(calls("interactions")).toHaveLength(2);
    expect((calls("interactions")[1].json() as { events: Interaction[] }).events.map((e) => e.kind)).toEqual(["click"]);
    client.setStatus(enabled);
    click(button);
    window.dispatchEvent(new Event("pagehide"));
    expect(beacon.fn).toHaveBeenCalled();
  });
});

function fakeRrweb() {
  let emit: RrwebRecordOptions["emit"] | null = null;
  const stopFn = vi.fn();
  const record = vi.fn((options: RrwebRecordOptions) => {
    emit = options.emit;
    return stopFn;
  }) as unknown as RrwebModule["record"] & { mock: { calls: [RrwebRecordOptions][] } };
  const module: RrwebModule = { record, addCustomEvent: vi.fn() };
  const loader = vi.fn(async () => module);
  let ts = 1000;
  const push = (checkout = false, size = 10) => {
    ts += 100;
    const event: RrwebEvent = { type: checkout ? 2 : 3, timestamp: ts, data: "x".repeat(size) };
    emit!(event, checkout);
    return event;
  };
  return { loader, record, stopFn, push, module, emitting: () => emit !== null };
}

describe("replay (rrweb)", () => {
  it("loads rrweb only with consent + collection.recordings + sampling, with every mask option", async () => {
    mockFetch();
    const rr = fakeRrweb();
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false, onError: false })], { consent: false });
    stop = client.start();
    await flushPromises();
    expect(rr.loader).not.toHaveBeenCalled();
    client.setConsent(true);
    await flushPromises();
    expect(rr.loader).not.toHaveBeenCalled(); // status unknown → fail closed
    client.setStatus({ ...enabled, collection: { recordings: false } });
    await flushPromises();
    expect(rr.loader).not.toHaveBeenCalled();
    client.setStatus(enabled);
    await flushPromises();
    expect(rr.loader).toHaveBeenCalledTimes(1);
    const options = rr.record.mock.calls[0][0];
    expect(options).toMatchObject({
      maskAllInputs: true,
      maskInputOptions: { password: true },
      blockSelector: BLOCK_SELECTOR,
      maskTextSelector: "[data-trapp-mask]",
      inlineImages: false,
      // выборочная сессия хранится/отправляется целиком — повторные полные снимки ей не нужны
      checkoutEveryNms: undefined,
    });
    expect(BLOCK_SELECTOR).toContain('input[type="password"]');
    expect(BLOCK_SELECTOR).toContain('input[autocomplete^="cc-"]');
    // картинки записываются ссылками (плеер их подгружает); вырезаются только с blockImages
    expect(BLOCK_SELECTOR).not.toContain("img");
    expect(BLOCK_IMAGES_SELECTOR).toContain("img:not([data-trapp-keep])");
    expect(BLOCK_SELECTOR).toContain("[data-trapp-block]");
    expect(options.maskTextFn!("Hello world")).toBe("***** *****");
  });

  it("lets server settings override options (sampling off, maskText on, onError on) and stops on consent withdrawal", async () => {
    mockFetch();
    const rr = fakeRrweb();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false, sampleRate: 1, onError: false, maskText: false, onErrorSampleRate: 1 })], { consent: true });
    client.setStatus({ ...enabled, recordings: { sampleRate: 0, onError: true, maskText: true } });
    stop = client.start();
    await flushPromises();
    expect(rr.record).toHaveBeenCalledTimes(1);
    expect(rr.record.mock.calls[0][0].maskTextSelector).toBe("*");
    client.setConsent(false);
    expect(rr.stopFn).toHaveBeenCalled();
  });

  it("streams sampled sessions in chunks every 5 s or 64 KB with seq/trigger/path and stops on 429", async () => {
    useFakeTimers();
    let status = 202;
    const { calls } = mockFetch(() => new Response(null, { status }));
    const rr = fakeRrweb();
    vi.spyOn(Math, "random").mockReturnValue(0);
    history.replaceState({}, "", "/pricing?x=1");
    // без порога: заливка с первого события (пороги — отдельный тест ниже)
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false, minClicks: 0, minDurationSec: 0 })], { consent: true });
    client.setStatus(enabled);
    stop = client.start();
    await flushPromises();
    rr.push(true);
    rr.push();
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(1);
    const first = calls("replay")[0];
    expect(Object.fromEntries(first.url.searchParams)).toEqual({ key: "pk_test", session: client.sessionId, seq: "0", trigger: "sample", path: "/pricing" });
    const chunk = first.json() as { from: number; to: number; events: RrwebEvent[] };
    expect(chunk.events).toHaveLength(2);
    expect(chunk.from).toBe(chunk.events[0].timestamp);
    expect(chunk.to).toBe(chunk.events[1].timestamp);
    // 64 KB flushes without waiting
    for (let i = 0; i < 70; i++) rr.push(false, 1024);
    await flushPromises();
    expect(calls("replay")).toHaveLength(2);
    expect(calls("replay")[1].url.searchParams.get("seq")).toBe("1");
    expect(calls("replay")[1].url.searchParams.has("trigger")).toBe(false);
    expect((calls("replay")[1].init.headers as Record<string, string>)["Content-Encoding"]).toBe("gzip");
    status = 429;
    rr.push();
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(rr.stopFn).toHaveBeenCalled();
    rr.push();
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(3);
  });

  it("uploads a sampled session only after 4 clicks and 10 s — from its very first snapshot", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const rr = fakeRrweb();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false, onError: false })], { consent: true });
    client.setStatus({ ...enabled, recordings: { minClicks: 4, minDurationSec: 10 } });
    stop = client.start();
    await flushPromises();
    const at = (ts: number, event: Partial<RrwebEvent>) => rr.record.mock.calls[0][0].emit({ timestamp: ts, ...event } as RrwebEvent);
    at(1_000, { type: 2, data: "snapshot" });
    // 3 клика за 20 секунд — визит неинтересный, ничего не уходит
    for (const ts of [3_000, 8_000, 21_000]) at(ts, { type: 3, data: { source: 2, type: 2 } as never });
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(0);
    // четвёртый клик — запись уходит целиком, с первого снимка
    at(22_000, { type: 3, data: { source: 2, type: 2 } as never });
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(1);
    const chunk = calls("replay")[0].json() as { events: RrwebEvent[] };
    expect(chunk.events[0].timestamp).toBe(1_000);
    expect(chunk.events).toHaveLength(5);
  });

  it("does not upload a sampled visit shorter than 10 s even with many clicks", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const rr = fakeRrweb();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false, onError: false })], { consent: true });
    client.setStatus({ ...enabled, recordings: { sampleRate: 1, minClicks: 4, minDurationSec: 10 } });
    stop = client.start();
    await flushPromises();
    const at = (ts: number, event: Partial<RrwebEvent>) => rr.record.mock.calls[0][0].emit({ timestamp: ts, ...event } as RrwebEvent);
    at(1_000, { type: 2, data: "snapshot" });
    for (let i = 0; i < 8; i++) at(1_500 + i * 500, { type: 3, data: { source: 2, type: 2 } as never });
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(10_000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(0);
  });

  it("buffers in onError mode and flushes the last checkouts on an error, then 30 s more", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const rr = fakeRrweb();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const client = makeClient([errors(), recordings({ loadRrweb: rr.loader, interactions: false, onErrorSampleRate: 1 })], { consent: true });
    client.setStatus(enabled);
    stop = client.start();
    await flushPromises();
    rr.push(true); // old checkout — rotated out below
    rr.push();
    rr.push(true);
    const kept = rr.push();
    vi.advanceTimersByTime(20_000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(0);
    client.captureException(new Error("boom"));
    await flushPromises();
    expect(calls("replay")).toHaveLength(1);
    expect(calls("replay")[0].url.searchParams.get("trigger")).toBe("error");
    const chunk = calls("replay")[0].json() as { events: RrwebEvent[] };
    expect(chunk.events).toHaveLength(4);
    expect(chunk.events[3].timestamp).toBe(kept.timestamp);
    expect(rr.module.addCustomEvent).toHaveBeenCalledWith("trapp:error", expect.objectContaining({ message: "boom" }));
    rr.push();
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(2);
    vi.advanceTimersByTime(30_000);
    rr.push();
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(2); // back to buffering
    expect(rr.record).toHaveBeenCalledTimes(1);
  });

  it("never loads rrweb when the loader fails, and info-level events do not trigger", async () => {
    mockFetch();
    const loader = vi.fn(async () => {
      throw new Error("offline");
    });
    const client = makeClient([errors(), recordings({ loadRrweb: loader, interactions: false, onErrorSampleRate: 1 })], { consent: true });
    client.setStatus(enabled);
    stop = client.start();
    await flushPromises();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(() => client.captureMessage("fyi")).not.toThrow();
  });
});

describe("replay on weak devices and old browsers", () => {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: unknown };
  afterEach(() => {
    delete (nav as { deviceMemory?: number }).deviceMemory;
    delete (nav as { connection?: unknown }).connection;
    vi.unstubAllGlobals();
  });

  it("does not load rrweb on ≤ 2 GB devices, data saver or 2G — unless skipWeakDevices is off", async () => {
    mockFetch();
    vi.spyOn(Math, "random").mockReturnValue(0);
    for (const setup of [
      () => Object.defineProperty(nav, "deviceMemory", { value: 2, configurable: true }),
      () => Object.defineProperty(nav, "connection", { value: { saveData: true }, configurable: true }),
      () => Object.defineProperty(nav, "connection", { value: { effectiveType: "2g" }, configurable: true }),
    ]) {
      setup();
      expect(weakDevice()).toBe(true);
      const rr = fakeRrweb();
      const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false })], { consent: true });
      client.setStatus(enabled);
      const stopIt = client.start();
      await flushPromises();
      expect(rr.loader).not.toHaveBeenCalled();
      stopIt();
      delete (nav as { deviceMemory?: number }).deviceMemory;
      delete (nav as { connection?: unknown }).connection;
    }
    // 3G — обычный мобильный интернет в Chrome, не повод не записывать
    Object.defineProperty(nav, "connection", { value: { effectiveType: "3g" }, configurable: true });
    expect(weakDevice()).toBe(false);
    delete (nav as { connection?: unknown }).connection;
    // выключенная проверка — rrweb грузится и на слабом устройстве
    Object.defineProperty(nav, "deviceMemory", { value: 1, configurable: true });
    const rr = fakeRrweb();
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false, skipWeakDevices: false })], { consent: true });
    client.setStatus(enabled);
    stop = client.start();
    await flushPromises();
    expect(rr.loader).toHaveBeenCalledTimes(1);
  });

  it("does not download rrweb without CompressionStream (the first chunk would exceed the limit)", async () => {
    mockFetch();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("CompressionStream", undefined);
    const rr = fakeRrweb();
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false })], { consent: true });
    client.setStatus(enabled);
    stop = client.start();
    await flushPromises();
    expect(rr.loader).not.toHaveBeenCalled();
  });

  it("keeps the onError buffer only for onErrorSampleRate of the not-sampled sessions", async () => {
    mockFetch();
    const rr = fakeRrweb();
    // 0.6: не попала ни в sampleRate (0.1), ни в onErrorSampleRate (0.5 по умолчанию)
    vi.spyOn(Math, "random").mockReturnValue(0.6);
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false })], { consent: true });
    client.setStatus(enabled);
    stop = client.start();
    await flushPromises();
    expect(rr.loader).not.toHaveBeenCalled();
  });

  it("drops a pending sampled visit that grows past the memory cap before it qualifies", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const rr = fakeRrweb();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false, onError: false })], { consent: true });
    client.setStatus(enabled);
    stop = client.start();
    await flushPromises();
    for (let i = 0; i < 70; i++) rr.push(false, 64 * 1024); // ~4.5 MB of mutations, no clicks
    expect(rr.stopFn).toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(0);
  });

  it("a sampled visit that hits an error keeps streaming instead of going back to a buffer", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    const rr = fakeRrweb();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const client = makeClient([errors(), recordings({ loadRrweb: rr.loader, interactions: false })], { consent: true });
    client.setStatus(enabled);
    stop = client.start();
    await flushPromises();
    rr.push(true);
    client.captureException(new Error("boom"));
    await flushPromises();
    expect(calls("replay")).toHaveLength(1);
    vi.advanceTimersByTime(35_000);
    rr.push();
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(calls("replay")).toHaveLength(2); // still streaming after the 30 s window
  });
});

describe("replay across reloads", () => {
  /** A page of the same tab: the session id stays in sessionStorage, the module starts from scratch. */
  async function page(rr: ReturnType<typeof fakeRrweb>, status: StatusSnapshot = enabled) {
    const client = makeClient([recordings({ loadRrweb: rr.loader, interactions: false, minClicks: 0, minDurationSec: 0 })], { consent: true });
    client.setStatus(status);
    const stopIt = client.start();
    await flushPromises();
    return { client, stopIt };
  }

  it("continues the recording of the tab after a reload instead of starting over from seq 0", async () => {
    useFakeTimers();
    const { calls } = mockFetch();
    mockBeacon();
    vi.spyOn(Math, "random").mockReturnValue(0);
    // first page: two chunks, seq 0 and 1
    const rrA = fakeRrweb();
    const a = await page(rrA);
    rrA.push(true);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    rrA.push();
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(calls("replay").map((c) => c.url.searchParams.get("seq"))).toEqual(["0", "1"]);
    // the tab reloads: the last chunk leaves as a beacon, which must not end the recording
    rrA.push();
    window.dispatchEvent(new Event("pagehide"));
    await flushPromises();
    a.stopIt();

    // even a visit that would not be sampled now goes on — it is the same recording
    vi.mocked(Math.random).mockReturnValue(0.99);
    const rrB = fakeRrweb();
    const b = await page(rrB);
    expect(b.client.sessionId).toBe(a.client.sessionId);
    expect(rrB.loader).toHaveBeenCalledTimes(1);
    rrB.push(true);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    const next = calls("replay").at(-1)!;
    expect(next.url.searchParams.get("seq")).toBe("3");
    expect(next.url.searchParams.has("trigger")).toBe(false);
    expect((next.json() as { events: RrwebEvent[] }).events[0].type).toBe(2); // a fresh full snapshot
    b.stopIt();
  });

  it("does not start again in a tab whose recording the server ended", async () => {
    useFakeTimers();
    const { calls } = mockFetch(() => new Response(null, { status: 409 }));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const rrA = fakeRrweb();
    const a = await page(rrA);
    rrA.push(true);
    vi.advanceTimersByTime(5000);
    await flushPromises();
    expect(rrA.stopFn).toHaveBeenCalled();
    a.stopIt();

    const rrB = fakeRrweb();
    const b = await page(rrB);
    expect(rrB.loader).not.toHaveBeenCalled();
    expect(calls("replay")).toHaveLength(1);
    b.stopIt();
  });
});
