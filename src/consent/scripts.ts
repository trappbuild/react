import { CONSENT_CATEGORIES, type ConsentCategory, type ConsentState } from "./types.js";
import { devWarn } from "../core/env.js";

/**
 * Cookiebot-style blocking. Mark third-party scripts as inert:
 *
 *   <script type="text/plain" data-trapp-consent="statistics" src="https://..."></script>
 *   <script type="text/plain" data-trapp-consent="marketing" data-trapp-type="module">…</script>
 *
 * and iframes by moving `src` to `data-src`:
 *
 *   <iframe data-trapp-consent="marketing" data-src="https://www.youtube.com/embed/…"></iframe>
 *
 * They are activated only once every listed category (comma-separated) is granted.
 */
const ATTR = "data-trapp-consent";
const TYPE_ATTR = "data-trapp-type";
const ACTIVATED_ATTR = `${ATTR}-activated`;

const SCRIPT_SELECTOR = `script[type="text/plain"][${ATTR}]:not([${ACTIVATED_ATTR}])`;
const IFRAME_SELECTOR = `iframe[${ATTR}][data-src]`;
const SELECTOR = `${SCRIPT_SELECTOR}, ${IFRAME_SELECTOR}`;

type StateSource = ConsentState | (() => ConsentState);
type ScriptJob = { original: HTMLScriptElement; getState: () => ConsentState };
type ScriptQueue = {
  jobs: ScriptJob[];
  pending: WeakMap<HTMLScriptElement, ScriptJob>;
  draining: boolean;
  running?: { original: HTMLScriptElement; script: HTMLScriptElement; finish: () => void };
};

// A single queue also preserves order across consent changes and SPA mutation batches.
const queues = new WeakMap<Document, ScriptQueue>();

/**
 * Categories an element requires, or null when the attribute is empty or names an unknown
 * category. Null never activates: a typo or injected `data-trapp-consent=""` must fail closed.
 */
function requiredCategories(el: Element): ConsentCategory[] | null {
  const names = (el.getAttribute(ATTR) ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (!names.length || !names.every((c) => (CONSENT_CATEGORIES as string[]).includes(c))) {
    devWarn(`ignoring element with invalid ${ATTR}="${el.getAttribute(ATTR) ?? ""}"`);
    return null;
  }
  return names as ConsentCategory[];
}

/** True only when every category is explicitly granted — never through the prototype chain. */
function allGranted(required: ConsentCategory[], state: ConsentState) {
  return required.every((c) => Object.prototype.hasOwnProperty.call(state, c) && state[c] === true);
}

function createScript(original: HTMLScriptElement, required: ConsentCategory[]) {
  const script = original.ownerDocument.createElement("script");
  for (const { name, value } of Array.from(original.attributes)) {
    // The original stays in place for React, including its unique id.
    if (name === "type" || name === "id" || name === ATTR || name === TYPE_ATTR) continue;
    script.setAttribute(name, value);
  }
  const type = original.getAttribute(TYPE_ATTR);
  if (type) script.type = type;
  // Browsers hide the nonce attribute after parsing; the property still has it.
  if (original.nonce) script.nonce = original.nonce;
  // The queue also waits for load/error before inserting dependent inline scripts.
  if (original.src && !original.hasAttribute("async")) script.async = false;
  script.setAttribute(ACTIVATED_ATTR, required.join(","));
  if (!original.src) script.text = original.text;

  return script;
}

function waitsForLoad(script: HTMLScriptElement) {
  // Inline modules have native deferred semantics and do not dispatch load.
  // Dependencies between modules belong in their import graph.
  if (!script.src) return false;
  const type = script.type.trim().toLowerCase();
  if (type === "module") return true;
  const classic =
    !type ||
    /^(?:(?:application|text)\/(?:x-)?(?:ecmascript|javascript)|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(type);
  // Modern browsers skip nomodule scripts without dispatching load/error.
  return classic && !script.noModule;
}

function insertScript(original: HTMLScriptElement, script: HTMLScriptElement) {
  original.setAttribute(ACTIVATED_ATTR, script.getAttribute(ACTIVATED_ATTR)!);
  // Replacing this node would invalidate React's reference and break later updates/removal.
  original.after(script);
}

function drain(queue: ScriptQueue) {
  if (queue.draining) return;
  queue.draining = true;
  try {
    if (queue.running) {
      const { original, script, finish } = queue.running;
      if (original.isConnected && script.isConnected) return;
      finish();
    }
    while (!queue.running && queue.jobs.length) {
      const { original, getState } = queue.jobs.shift()!;
      queue.pending.delete(original);
      if (!original.isConnected || !original.matches(SCRIPT_SELECTOR)) continue;
      const required = requiredCategories(original);
      if (!required || !allGranted(required, getState())) continue;

      const script = createScript(original, required);
      if (!waitsForLoad(script)) {
        insertScript(original, script);
        script.remove();
        continue;
      }

      const observer = new MutationObserver(() => drain(queue));
      const finish = () => {
        if (queue.running?.script !== script) return;
        queue.running = undefined;
        observer.disconnect();
        script.removeEventListener("load", finish);
        script.removeEventListener("error", finish);
        script.remove();
        drain(queue);
      };
      queue.running = { original, script, finish };
      script.addEventListener("load", finish);
      script.addEventListener("error", finish);
      insertScript(original, script);
      // Removed SPA content must not leave the queue waiting for an event that never arrives.
      observer.observe(original.ownerDocument.documentElement, { childList: true, subtree: true });
    }
  } finally {
    queue.draining = false;
  }
}

function activateScript(original: HTMLScriptElement, getState: () => ConsentState) {
  // Explicit async scripts are independent of the ordered queue, including async modules.
  if (
    original.hasAttribute("async") &&
    (original.src || original.getAttribute(TYPE_ATTR) === "module")
  ) {
    const required = requiredCategories(original);
    if (!required) return;
    const script = createScript(original, required);
    const cleanup = () => script.remove();
    script.addEventListener("load", cleanup, { once: true });
    script.addEventListener("error", cleanup, { once: true });
    insertScript(original, script);
    if (!waitsForLoad(script)) cleanup();
    return;
  }

  let queue = queues.get(original.ownerDocument);
  if (!queue) {
    queue = { jobs: [], pending: new WeakMap(), draining: false };
    queues.set(original.ownerDocument, queue);
  }
  const pending = queue.pending.get(original);
  if (pending) {
    // A remounted provider can resume this node using a new consent manager.
    pending.getState = getState;
  } else {
    const job = { original, getState };
    queue.pending.set(original, job);
    queue.jobs.push(job);
  }
  drain(queue);
}

/** Only web URLs may be loaded into a frame; `javascript:`/`data:` stay blocked forever. */
function safeFrameUrl(value: string): string | null {
  try {
    const url = new URL(value, document.baseURI);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function activateIframe(iframe: HTMLIFrameElement, required: ConsentCategory[]) {
  const src = safeFrameUrl(iframe.getAttribute("data-src") ?? "");
  if (!src) {
    devWarn("blocked iframe data-src must be an http(s) URL");
    return;
  }
  iframe.src = src;
  iframe.removeAttribute("data-src");
  iframe.removeAttribute(ATTR);
  iframe.setAttribute(ACTIVATED_ATTR, required.join(","));
}

function activate(elements: Iterable<Element>, getState: () => ConsentState) {
  for (const el of elements) {
    // One element's failure must not stop the others, nor reach the host's React tree.
    try {
      // The same node can be reported twice by a mutation batch, or already activated.
      if (!el.isConnected || !el.matches(SELECTOR)) continue;
      const required = requiredCategories(el);
      if (!required || !allGranted(required, getState())) continue;
      if (el instanceof HTMLScriptElement) activateScript(el, getState);
      else if (el instanceof HTMLIFrameElement) activateIframe(el, required);
    } catch (error) {
      devWarn("failed to activate a blocked element", error);
    }
  }
}

export function activateScripts(state: StateSource, root: ParentNode | null = null) {
  if (typeof document === "undefined") return;
  const getState = typeof state === "function" ? state : () => state;
  activate((root ?? document).querySelectorAll(SELECTOR), getState);
}

/**
 * Activates blocked elements added after start-up (SPA navigation, `next/script`, embeds
 * rendered by React). Returns a disconnect function.
 */
export function observeBlockedElements(getState: () => ConsentState): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const observer = new MutationObserver((mutations) => {
    const found: Element[] = [];
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(SELECTOR)) found.push(node);
        else if (node.firstElementChild) found.push(...Array.from(node.querySelectorAll(SELECTOR)));
      });
    }
    if (found.length) activate(found, getState);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}
