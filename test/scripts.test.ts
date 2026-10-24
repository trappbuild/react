import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { activateScripts, observeBlockedElements } from "../src/consent/scripts";
import type { ConsentState } from "../src/consent/types";

const granted = (overrides: Partial<ConsentState> = {}): ConsentState => ({
  necessary: true,
  preferences: true,
  statistics: true,
  marketing: true,
  ...overrides,
});

const activated = (id: string) => document.getElementById(id)!.hasAttribute("data-trapp-consent-activated");
const executable = (id: string) => document.getElementById(id)!.nextElementSibling as HTMLScriptElement;
const runs = (id: string) => Number(document.getElementById(id)!.dataset.runs ?? 0);
const countExecution = `(() => {
  const source = document.currentScript.previousElementSibling;
  source.dataset.runs = String(Number(source.dataset.runs ?? 0) + 1);
})()`;

describe("activateScripts", () => {
  it("activates only when every listed category is granted", () => {
    document.body.innerHTML = `
      <script type="text/plain" data-trapp-consent="statistics" id="a">${countExecution}</script>
      <script type="text/plain" data-trapp-consent="statistics, marketing" id="b">${countExecution}</script>`;
    activateScripts(granted({ marketing: false }));

    expect(document.getElementById("a")!.getAttribute("type")).toBe("text/plain");
    expect(document.getElementById("a")!.getAttribute("data-trapp-consent-activated")).toBe("statistics");
    expect(activated("b")).toBe(false);
    expect(runs("a")).toBe(1);
    expect(runs("b")).toBe(0);
  });

  it("keeps document order for external scripts unless they were marked async", () => {
    document.body.innerHTML = `
      <script type="text/plain" data-trapp-consent="statistics" src="https://x.test/a.js" id="ordered"></script>
      <script type="text/plain" data-trapp-consent="statistics" src="https://x.test/b.js" async id="async"></script>`;
    activateScripts(granted());

    expect(executable("ordered").async).toBe(false);
    // jsdom doesn't reflect `async` as a property; the attribute is what browsers read.
    expect(executable("async").hasAttribute("async")).toBe(true);
    executable("ordered").dispatchEvent(new Event("load"));
    executable("async").dispatchEvent(new Event("load"));
  });

  it("restores the real script type from data-trapp-type", () => {
    document.body.innerHTML = `<script type="text/plain" data-trapp-consent="statistics" data-trapp-type="module" src="https://x.test/module.js" id="m"></script>`;
    activateScripts(granted());

    const script = executable("m");
    expect(script.getAttribute("type")).toBe("module");
    expect(script.hasAttribute("data-trapp-type")).toBe(false);
    script.dispatchEvent(new Event("load"));
  });

  it("waits for an external script before activating dependent inline code", () => {
    document.body.innerHTML = `
      <script type="text/plain" data-trapp-consent="statistics" src="https://x.test/library.js" id="library"></script>
      <script type="text/plain" data-trapp-consent="statistics" id="init">${countExecution}</script>`;
    activateScripts(granted());
    expect(activated("init")).toBe(false);
    expect(runs("init")).toBe(0);

    // Repeated start-up must neither bypass the pending library nor enqueue init twice.
    activateScripts(granted());
    expect(document.querySelectorAll('script[src="https://x.test/library.js"]')).toHaveLength(2);
    expect(runs("init")).toBe(0);
    executable("library").dispatchEvent(new Event("load"));
    expect(activated("init")).toBe(true);
    expect(runs("init")).toBe(1);
    activateScripts(granted());
    expect(runs("init")).toBe(1);
    expect(document.querySelectorAll("script")).toHaveLength(2);
  });

  it("continues after module errors and allows explicit async scripts to bypass the queue", () => {
    document.body.innerHTML = `
      <script type="text/plain" data-trapp-consent="statistics" data-trapp-type="module" src="https://x.test/module.js" id="module"></script>
      <script type="text/plain" data-trapp-consent="statistics" src="https://x.test/async.js" async id="async"></script>
      <script type="text/plain" data-trapp-consent="statistics" id="after">${countExecution}</script>`;
    activateScripts(granted());
    expect(activated("async")).toBe(true);
    expect(activated("after")).toBe(false);
    expect(runs("after")).toBe(0);
    executable("module").dispatchEvent(new Event("error"));
    expect(activated("after")).toBe(true);
    expect(runs("after")).toBe(1);
    executable("async").dispatchEvent(new Event("load"));
  });

  it("does not wait for a load event from inline modules", () => {
    document.body.innerHTML = `
      <script type="text/plain" data-trapp-consent="statistics" data-trapp-type="module" id="module">export const ready = true;</script>
      <script type="text/plain" data-trapp-consent="statistics" id="after">${countExecution}</script>`;
    activateScripts(granted());
    expect(activated("module")).toBe(true);
    expect(activated("after")).toBe(true);
    expect(runs("after")).toBe(1);
  });

  it("rechecks consent for queued scripts and retries them after consent is granted again", () => {
    document.body.innerHTML = `
      <script type="text/plain" data-trapp-consent="statistics" src="https://x.test/library.js" id="library"></script>
      <script type="text/plain" data-trapp-consent="statistics" id="init">${countExecution}</script>`;
    let state = granted();
    activateScripts(() => state);
    expect(runs("init")).toBe(0);
    state = granted({ statistics: false });
    executable("library").dispatchEvent(new Event("load"));
    expect(activated("init")).toBe(false);
    expect(runs("init")).toBe(0);
    state = granted();
    activateScripts(() => state);
    expect(activated("init")).toBe(true);
    expect(runs("init")).toBe(1);
    activateScripts(() => state);
    expect(runs("init")).toBe(1);
  });

  it("uses the latest consent source when a new provider resumes a queued script", () => {
    document.body.innerHTML = `
      <script type="text/plain" data-trapp-consent="statistics" src="https://x.test/library.js" id="library"></script>
      <script type="text/plain" data-trapp-consent="statistics" id="init">${countExecution}</script>`;
    let previousState = granted();
    activateScripts(() => previousState);
    previousState = granted({ statistics: false });

    // The old provider stopped; its replacement has consent under the same policy.
    activateScripts(() => granted());
    expect(runs("init")).toBe(0);
    executable("library").dispatchEvent(new Event("load"));
    expect(activated("init")).toBe(true);
    expect(runs("init")).toBe(1);
  });

  it("continues the queue when a loading script is removed during navigation", async () => {
    document.body.innerHTML = `
      <div id="route"><script type="text/plain" data-trapp-consent="statistics" src="https://x.test/library.js"></script></div>
      <script type="text/plain" data-trapp-consent="statistics" id="next">${countExecution}</script>`;
    activateScripts(granted());
    expect(runs("next")).toBe(0);
    document.getElementById("route")!.remove();
    await new Promise((resolve) => setTimeout(resolve));
    expect(activated("next")).toBe(true);
    expect(runs("next")).toBe(1);
  });

  it("preserves React-owned nodes so conditional removal does not unmount the application", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const errors: unknown[] = [];
    const root = createRoot(container, { onUncaughtError: (error) => errors.push(error) });
    const view = (show: boolean) => createElement("div", null,
      show && createElement("script", { id: "owned", type: "text/plain", "data-trapp-consent": "statistics" }, countExecution),
      createElement("p", null, "Content"));
    flushSync(() => root.render(view(true)));
    const original = document.getElementById("owned");
    activateScripts(granted());
    expect(document.getElementById("owned")).toBe(original);
    expect(runs("owned")).toBe(1);
    flushSync(() => root.render(view(false)));
    expect(errors).toEqual([]);
    expect(container.textContent).toBe("Content");
    root.unmount();
  });

  it("loads blocked iframes from data-src", () => {
    document.body.innerHTML = `<iframe data-trapp-consent="marketing" data-src="https://video.test/embed" id="f"></iframe>`;
    activateScripts(granted({ marketing: false }));
    expect(document.getElementById("f")!.getAttribute("src")).toBeNull();

    activateScripts(granted());
    const iframe = document.getElementById("f")!;
    expect(iframe.getAttribute("src")).toBe("https://video.test/embed");
    expect(iframe.hasAttribute("data-src")).toBe(false);
  });
});

describe("observeBlockedElements", () => {
  it("activates blocked elements added later", async () => {
    const stop = observeBlockedElements(() => granted());
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<script type="text/plain" data-trapp-consent="statistics" id="late">${countExecution}</script>`;
    document.body.append(wrapper);

    await new Promise((resolve) => setTimeout(resolve));
    expect(activated("late")).toBe(true);
    expect(runs("late")).toBe(1);
    stop();
  });
});
