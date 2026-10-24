import { describe, expect, it, vi } from "vitest";
import { readCookie } from "../src/consent/cookie";
import { CONSENT_EVENT, ConsentManager } from "../src/consent/manager";
import { clearCookies } from "./setup";

const blockedScript = () => {
  document.body.innerHTML = `<script type="text/plain" data-trapp-consent="statistics" id="s"></script>`;
  return () => document.getElementById("s")!;
};

function mockBeacon() {
  const sendBeacon = vi.fn((_url: string, _data?: BodyInit | null) => true);
  Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true });
  return sendBeacon;
}

describe("ConsentManager", () => {
  it("has no side effects until start()", () => {
    const script = blockedScript();
    document.cookie = `trapp_consent=${encodeURIComponent(
      JSON.stringify({
        id: "x",
        version: 1,
        timestamp: "",
        method: "accept_all",
        categories: { necessary: true, preferences: true, statistics: true, marketing: true },
      }),
    )}; path=/`;

    const manager = new ConsentManager();
    expect(manager.hasDecided()).toBe(true);
    expect(script().getAttribute("type")).toBe("text/plain");

    const stop = manager.start();
    expect(script().getAttribute("data-trapp-consent-activated")).toBe("statistics");
    stop();
  });

  it("stores the decision, activates scripts, notifies and fires the window event", () => {
    const script = blockedScript();
    const manager = new ConsentManager();
    const listener = vi.fn();
    const onEvent = vi.fn();
    manager.subscribe(listener);
    window.addEventListener(CONSENT_EVENT, onEvent);

    manager.save({ statistics: true });

    expect(manager.getState()).toEqual({
      necessary: true,
      preferences: false,
      statistics: true,
      marketing: false,
    });
    expect(readCookie("trapp_consent")).toContain("statistics");
    expect(script().getAttribute("data-trapp-consent-activated")).toBe("statistics");
    expect(listener).toHaveBeenCalledTimes(1);
    expect((onEvent.mock.calls[0][0] as CustomEvent).detail.method).toBe("custom");
    window.removeEventListener(CONSENT_EVENT, onEvent);
  });

  it("reports decisions as text/plain", async () => {
    const sendBeacon = mockBeacon();
    new ConsentManager({ reportUrl: "https://api.test/consent", projectId: "p1" }).acceptAll();

    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe("https://api.test/consent");
    expect((blob as Blob).type).toBe("text/plain;charset=utf-8");
    const body = JSON.parse(await (blob as Blob).text());
    // Backend contract (model.rs ConsentIn): categories is the list of granted names.
    expect(body).toMatchObject({
      projectId: "p1",
      method: "accept_all",
      categories: ["necessary", "preferences", "statistics", "marketing"],
      url: location.origin + location.pathname,
    });
    expect(body).not.toHaveProperty("userAgent");
    expect(Object.keys(body).sort()).toEqual(["categories", "id", "method", "projectId", "timestamp", "url", "version"]);
  });

  it("treats reset() as a reported withdrawal and fires the event with null", async () => {
    const sendBeacon = mockBeacon();
    const manager = new ConsentManager({ reportUrl: "https://api.test/consent" });
    manager.acceptAll();
    const id = manager.getRecord()!.id;

    const onEvent = vi.fn();
    window.addEventListener(CONSENT_EVENT, onEvent);
    manager.reset();
    window.removeEventListener(CONSENT_EVENT, onEvent);

    expect(manager.hasDecided()).toBe(false);
    expect(readCookie("trapp_consent")).toBeNull();
    expect((onEvent.mock.calls[0][0] as CustomEvent).detail).toBeNull();
    const withdrawal = JSON.parse(await (sendBeacon.mock.calls[1][1] as Blob).text());
    expect(withdrawal).toMatchObject({ id, method: "reset", categories: ["necessary"] });

    // The next decision keeps the same consent id.
    manager.rejectAll();
    expect(manager.getRecord()!.id).toBe(id);
  });

  it("re-asks after a policy version bump but keeps the consent id", () => {
    const v1 = new ConsentManager({ version: 1 });
    v1.acceptAll();
    const id = v1.getRecord()!.id;

    const v2 = new ConsentManager({ version: 2 });
    expect(v2.hasDecided()).toBe(false);
    v2.rejectAll();
    expect(v2.getRecord()).toMatchObject({ id, version: 2 });
  });

  it("picks up a decision made in another tab", () => {
    const manager = new ConsentManager();
    const stop = manager.start();
    const listener = vi.fn();
    manager.subscribe(listener);

    new ConsentManager().acceptAll(); // "another tab" writes the shared cookie
    window.dispatchEvent(new Event("focus"));

    expect(manager.has("marketing")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it("sends Google Consent Mode v2 default and update commands", () => {
    const manager = new ConsentManager({ googleConsentMode: true });
    const stop = manager.start();
    manager.start()(); // a second start (StrictMode) must not send another default
    manager.save({ statistics: true });
    stop();

    const commands = window.dataLayer!.map((entry) => Array.from(entry as ArrayLike<unknown>));
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual([
      "consent",
      "default",
      expect.objectContaining({ analytics_storage: "denied", ad_storage: "denied", wait_for_update: 500 }),
    ]);
    expect(commands[1]).toEqual([
      "consent",
      "update",
      expect.objectContaining({ analytics_storage: "granted", ad_user_data: "denied" }),
    ]);
    // gtag.js only accepts `arguments` objects, not arrays.
    expect(Array.isArray(window.dataLayer![0])).toBe(false);
  });

  it("updates Google consent before a newly allowed script executes", () => {
    document.body.innerHTML = `<script type="text/plain" data-trapp-consent="statistics">document.dispatchEvent(new Event("trapp:test-measurement"))</script>`;
    const commands: unknown[][] = [];
    window.gtag = (...args: unknown[]) => { commands.push(args); };
    const onMeasurement = () => { commands.push(["event", "measurement"]); };
    document.addEventListener("trapp:test-measurement", onMeasurement);
    const manager = new ConsentManager({ googleConsentMode: true });
    const stop = manager.start();
    try {
      manager.save({ statistics: true });

      expect(commands).toHaveLength(3);
      expect(commands[0]).toEqual([
        "consent",
        "default",
        expect.objectContaining({ analytics_storage: "denied" }),
      ]);
      expect(commands[1]).toEqual([
        "consent",
        "update",
        expect.objectContaining({ analytics_storage: "granted" }),
      ]);
      expect(commands[2]).toEqual(["event", "measurement"]);
    } finally {
      stop();
      document.removeEventListener("trapp:test-measurement", onMeasurement);
    }
  });

  it.each(["stopped", "restarted", "replaced", "new policy"])(
    "rechecks pending scripts when a manager is %s",
    (lifecycle) => {
      document.body.innerHTML = `
        <script id="library" type="text/plain" data-trapp-consent="statistics" src="https://x.test/library.js"></script>
        <script id="init" type="text/plain" data-trapp-consent="statistics">document.getElementById("init").dataset.executed = "true"</script>`;
      const manager = new ConsentManager();
      const stop = manager.start();
      manager.acceptAll();
      const executable = document.getElementById("library")!.nextElementSibling!;
      const init = document.getElementById("init")!;
      expect(init.hasAttribute("data-trapp-consent-activated")).toBe(false);
      stop();
      stop(); // Cleanup is idempotent.

      let stopNext: (() => void) | undefined;
      if (lifecycle === "restarted") stopNext = manager.start();
      if (lifecycle === "replaced") stopNext = new ConsentManager().start();
      if (lifecycle === "new policy") stopNext = new ConsentManager({ version: 2 }).start();
      try {
        executable.dispatchEvent(new Event("load"));
        expect(init.hasAttribute("data-trapp-consent-activated"))
          .toBe(lifecycle === "restarted" || lifecycle === "replaced");
        expect(init.dataset.executed)
          .toBe(lifecycle === "restarted" || lifecycle === "replaced" ? "true" : undefined);
      } finally {
        stopNext?.();
      }
    },
  );

  it("reloads on withdrawal when asked to", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      value: { ...original, reload },
      configurable: true,
    });
    try {
      const manager = new ConsentManager({ reloadOnWithdraw: true });
      manager.acceptAll();
      expect(reload).not.toHaveBeenCalled();
      manager.reset();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { value: original, configurable: true });
      clearCookies();
    }
  });
});
