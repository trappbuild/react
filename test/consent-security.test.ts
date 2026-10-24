import { describe, expect, it } from "vitest";
import { parseRecord } from "../src/consent/cookie";
import { activateScripts } from "../src/consent/scripts";
import type { ConsentState } from "../src/consent/types";

const all: ConsentState = { necessary: true, preferences: true, statistics: true, marketing: true };

describe("security: blocked element activation (H3)", () => {
  it.each(["", " ", ",", "__proto__", "constructor", "statistics,unknown", "Statistics"])(
    "never activates for data-trapp-consent=%j",
    (value) => {
      document.body.innerHTML = `<script type="text/plain" data-trapp-consent="${value}" id="s">window.__pwned = true</script>
        <iframe data-trapp-consent="${value}" data-src="https://video.test/embed" id="f"></iframe>`;
      activateScripts(all);
      expect(document.getElementById("s")!.hasAttribute("data-trapp-consent-activated")).toBe(false);
      expect(document.getElementById("f")!.getAttribute("src")).toBeNull();
      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    },
  );

  it("requires an own, true property — a polluted prototype does not count", () => {
    document.body.innerHTML = `<script type="text/plain" data-trapp-consent="marketing" id="s"></script>`;
    const state = Object.create({ marketing: true }) as ConsentState;
    Object.assign(state, { necessary: true, preferences: false, statistics: false });
    activateScripts(state);
    expect(document.getElementById("s")!.hasAttribute("data-trapp-consent-activated")).toBe(false);
    activateScripts(all);
    expect(document.getElementById("s")!.hasAttribute("data-trapp-consent-activated")).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "blob:https://x.test/1", "about:blank"])(
    "keeps an iframe blocked for data-src=%j",
    (src) => {
      document.body.innerHTML = `<iframe data-trapp-consent="marketing" id="f"></iframe>`;
      document.getElementById("f")!.setAttribute("data-src", src);
      activateScripts(all);
      const iframe = document.getElementById("f")!;
      expect(iframe.getAttribute("src")).toBeNull();
      expect(iframe.hasAttribute("data-trapp-consent-activated")).toBe(false);
    },
  );

  it("resolves relative http(s) frame URLs against the document", () => {
    document.body.innerHTML = `<iframe data-trapp-consent="marketing" data-src="/embed/1" id="f"></iframe>`;
    activateScripts(all);
    expect(document.getElementById("f")!.getAttribute("src")).toBe(new URL("/embed/1", document.baseURI).href);
  });

  it("survives a throwing element without affecting the others", () => {
    document.body.innerHTML = `<iframe data-trapp-consent="marketing" data-src="https://a.test/" id="bad"></iframe>
      <iframe data-trapp-consent="marketing" data-src="https://b.test/" id="good"></iframe>`;
    Object.defineProperty(document.getElementById("bad"), "src", {
      set() {
        throw new Error("boom");
      },
    });
    expect(() => activateScripts(all)).not.toThrow();
    expect(document.getElementById("good")!.getAttribute("src")).toBe("https://b.test/");
  });
});

describe("security: cookie parser allowlist", () => {
  const record = {
    id: "abc",
    version: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    method: "custom",
    categories: { necessary: true, preferences: false, statistics: true, marketing: false },
  };

  it("returns a fresh object with only the known fields", () => {
    const parsed = parseRecord(JSON.stringify({ ...record, extra: 1, categories: { ...record.categories, evil: true } }));
    expect(parsed).toEqual(record);
    expect(Object.keys(parsed!.categories)).toEqual(["necessary", "preferences", "statistics", "marketing"]);
  });

  it("does not let __proto__ through", () => {
    const parsed = parseRecord(`{"id":"a","version":1,"timestamp":"t","method":"custom","__proto__":{"admin":true},"categories":{"necessary":true,"preferences":false,"statistics":false,"marketing":false,"__proto__":{"marketing":true}}}`);
    expect(parsed).not.toBeNull();
    expect((parsed as unknown as { admin?: boolean }).admin).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(parsed!.categories.marketing).toBe(false);
  });

  it.each([
    ["unknown method", { ...record, method: "hacked" }],
    ["missing method", { ...record, method: undefined }],
    ["non-string timestamp", { ...record, timestamp: 123 }],
    ["empty id", { ...record, id: "" }],
    ["id over 64 chars", { ...record, id: "x".repeat(65) }],
    ["non-finite version", { ...record, version: Infinity }],
    ["array categories", { ...record, categories: [true, true, true, true] }],
    ["string category", { ...record, categories: { ...record.categories, statistics: "true" } }],
  ])("rejects %s", (_, raw) => {
    expect(parseRecord(JSON.stringify(raw))).toBeNull();
  });

  it("accepts an id of exactly 64 chars and every known method", () => {
    expect(parseRecord(JSON.stringify({ ...record, id: "x".repeat(64) }))).not.toBeNull();
    for (const method of ["accept_all", "reject_all", "custom", "reset"]) {
      expect(parseRecord(JSON.stringify({ ...record, method }))!.method).toBe(method);
    }
  });
});
