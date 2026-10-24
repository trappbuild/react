import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errors } from "../src/errors";
import { maintenance } from "../src/maintenance";
import { DEFAULT_WARNING_TEXT, HOST_ID } from "../src/maintenance/banner";
import { crashRedirect, RECOVERY_MS } from "../src/maintenance/crash";
import { allowedMaintenanceUrl } from "../src/maintenance/lockdown";
import { flushPromises, makeClient, mockFetch, mockLocation, removeBeacon, useFakeTimers } from "./helpers";

const STUB = "https://maintenance.trapp.build/org/app";
let status: Record<string, unknown> = { mode: null, warning: null, lockdown: null, maintenanceUrl: STUB };
let stop: () => void = () => {};
let loc: ReturnType<typeof mockLocation>;

const banner = () => document.getElementById(HOST_ID)?.shadowRoot?.querySelector(".b") ?? null;

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  status = { mode: null, warning: null, lockdown: null, maintenanceUrl: STUB };
  loc = mockLocation();
});
afterEach(() => {
  stop();
  loc.restore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  removeBeacon();
});

function statusFetch() {
  return mockFetch((url) => (url.pathname.endsWith("/status") ? Response.json(status) : new Response(null, { status: 202 })));
}

describe("allowedMaintenanceUrl", () => {
  it("accepts only https://maintenance.trapp.build or the configured origin", () => {
    expect(allowedMaintenanceUrl(STUB)).toBe(STUB);
    expect(allowedMaintenanceUrl("https://status.example.com/x", "https://status.example.com")).toBe("https://status.example.com/x");
    for (const bad of [
      "http://maintenance.trapp.build/o/a",
      "https://maintenance.trapp.build.evil.com/o/a",
      "https://evil.com/maintenance.trapp.build",
      "javascript:alert(1)",
      "https://user@maintenance.trapp.build/o/a",
      "//maintenance.trapp.build/o/a",
      "",
      null,
    ]) {
      expect(allowedMaintenanceUrl(bad, "https://status.example.com")).toBeNull();
    }
    expect(allowedMaintenanceUrl("https://status.example.com/x")).toBeNull();
  });
});

describe("status polling", () => {
  it("polls on start, then every server interval while visible, and refreshes when the tab returns", async () => {
    useFakeTimers();
    const { calls, sent } = statusFetch();
    status.interval = 45;
    const client = makeClient([maintenance()]);
    stop = client.start();
    await flushPromises();
    expect(calls("status")).toHaveLength(1);
    expect(sent[0].init.credentials).toBe("omit");
    expect(client.status?.interval).toBe(45);
    vi.advanceTimersByTime(44_000);
    expect(calls("status")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls("status")).toHaveLength(2);
    // Hidden tabs stop polling; coming back polls at once.
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(200_000);
    expect(calls("status")).toHaveLength(2);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(calls("status")).toHaveLength(3);
  });

  it("ignores failures and non-JSON and retries later", async () => {
    useFakeTimers();
    let fail = true;
    mockFetch(() => (fail ? new Response("<html>", { status: 502 }) : Response.json(status)));
    const client = makeClient([maintenance()]);
    stop = client.start();
    await flushPromises();
    expect(client.status).toBeNull();
    fail = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.status).not.toBeNull();
  });
});

describe("warning banner", () => {
  it("renders the text in a shadow root as text, with tone/shape/position classes, and redraws only on change", async () => {
    useFakeTimers();
    statusFetch();
    status.mode = "warning";
    status.warning = { text: "<b>Deploy</b> at 10:00", tone: "red", shape: "pill", position: "bottom", dismissible: false };
    const client = makeClient([maintenance()]);
    stop = client.start();
    await flushPromises();
    const el = banner()!;
    expect(el.className).toBe("b pill bottom");
    expect(el.querySelector("span")!.textContent).toBe("⚠ <b>Deploy</b> at 10:00");
    expect(el.querySelector("b")).toBeNull();
    expect((el as HTMLElement).style.background).toBe("rgb(255, 77, 109)");
    expect(el.querySelector("button")).toBeNull();
    const host = document.getElementById(HOST_ID);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(document.getElementById(HOST_ID)).toBe(host); // unchanged status → same node
    status.mode = null;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(banner()).toBeNull();
  });

  it("uses the default text, remembers a dismissal per session and shows new text again", async () => {
    useFakeTimers();
    statusFetch();
    status.mode = "warning";
    status.warning = { text: null, tone: "amber", shape: "bar", position: "top", dismissible: true };
    const client = makeClient([maintenance()]);
    stop = client.start();
    await flushPromises();
    expect(banner()!.textContent).toContain(DEFAULT_WARNING_TEXT);
    banner()!.querySelector("button")!.click();
    expect(banner()).toBeNull();
    stop();
    stop = makeClient([maintenance()]).start();
    await flushPromises();
    expect(banner()).toBeNull();
    status.warning = { ...(status.warning as object), text: "New text" };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(banner()!.textContent).toContain("New text");
  });
});

describe("lockdown", () => {
  it("redirects to a verified stub with ?from=", async () => {
    statusFetch();
    status.mode = "lockdown";
    stop = makeClient([maintenance()]).start();
    await flushPromises();
    expect(loc.replace).toHaveBeenCalledWith(`${STUB}?from=${encodeURIComponent(location.origin + "/")}`);
  });

  it("ignores a tampered maintenanceUrl unless its origin was configured", async () => {
    statusFetch();
    status.mode = "lockdown";
    status.maintenanceUrl = "https://evil.test/phish";
    stop = makeClient([maintenance()]).start();
    await flushPromises();
    expect(loc.replace).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("maintenanceUrl rejected"), expect.anything());
    stop();
    stop = makeClient([maintenance({ maintenanceOrigin: "https://evil.test" })]).start();
    await flushPromises();
    expect(loc.replace).toHaveBeenCalledWith(`https://evil.test/phish?from=${encodeURIComponent(location.origin + "/")}`);
  });
});

describe("redirectOnCrash", () => {
  function crashClient(options = {}) {
    const client = makeClient([errors(), maintenance({ redirectOnCrash: true, ...options })]);
    stop = client.start();
    return client;
  }

  it("redirects with ?reason=error when the root boundary stays crashed for 10 s and reports a fatal event", async () => {
    useFakeTimers();
    const { calls } = statusFetch();
    const client = crashClient();
    await flushPromises();
    client.emit("crash", { recovered: false });
    vi.advanceTimersByTime(RECOVERY_MS - 1);
    expect(loc.replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(loc.replace).toHaveBeenCalledWith(`${STUB}?reason=error&from=${encodeURIComponent(location.origin + "/")}`);
    expect(Number(sessionStorage.getItem("trapp_crash"))).toBeGreaterThan(0);
    await flushPromises();
    const body = calls("errors")[0].json() as { errors: { level: string; tags: Record<string, string> }[] };
    expect(body.errors[0]).toMatchObject({ level: "fatal", tags: { crash_redirect: "1" } });
  });

  it("does not redirect when the app recovers in time", async () => {
    useFakeTimers();
    statusFetch();
    const client = crashClient();
    await flushPromises();
    client.emit("crash", { recovered: false });
    vi.advanceTimersByTime(5000);
    client.emit("crash", { recovered: true });
    vi.advanceTimersByTime(RECOVERY_MS);
    expect(loc.replace).not.toHaveBeenCalled();
  });

  it("never loops: at most once per 5 minutes, never on ?trapp_retry=1, never without a verified URL", async () => {
    useFakeTimers();
    statusFetch();
    const client = crashClient();
    await flushPromises();
    expect(crashRedirect(client, undefined, undefined)).toBe(true);
    expect(crashRedirect(client, undefined, undefined)).toBe(false);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(crashRedirect(client, undefined, undefined)).toBe(true);
    sessionStorage.clear();
    loc.restore();
    loc = mockLocation({ search: "?trapp_retry=1" });
    expect(crashRedirect(client, undefined, undefined)).toBe(false);
    loc.restore();
    loc = mockLocation();
    client.status!.maintenanceUrl = "https://evil.test/";
    expect(crashRedirect(client, undefined, undefined)).toBe(false);
    client.status = null;
    expect(crashRedirect(client, undefined, undefined)).toBe(false);
    expect(crashRedirect(client, STUB, undefined)).toBe(true);
  });
});
