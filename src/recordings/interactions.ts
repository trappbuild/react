import { safe } from "../core/env.js";
import { watchRoutes } from "../core/routes.js";
import { isSensitiveField, labelFor, selectorFor } from "../core/selector.js";
import type { Client } from "../core/types.js";

/** One entry of the `interactions` payload (recordings-plan.md 9.1). */
export interface Interaction {
  ts: string;
  kind: "click" | "rage" | "dead" | "scroll" | "form" | "visibility";
  path: string;
  selector?: string;
  label?: string;
  x?: number;
  y?: number;
  vw?: number;
  vh?: number;
  count?: number;
  depth?: number;
  field?: string;
  step?: "focus" | "blur" | "submit";
  state?: "hidden" | "visible";
}

export const FLUSH_MS = 10_000;
export const FLUSH_AT = 50;
const RAGE_WINDOW_MS = 1000;
const RAGE_AT = 3;
const DEAD_WAIT_MS = 500;
const PATH_MAX = 300;
const FIELD_MAX = 50;
const INTERACTIVE = "a[href],button,input,select,textarea,label,summary,[role=button],[role=link],[onclick],[contenteditable],[tabindex]";

const pct = (n: number) => Math.round(Math.min(Math.max(n, 0), 100) * 10) / 10;

export interface InteractionSink {
  push(event: Interaction): void;
  pending(): Interaction[];
}

/**
 * The light layer: clicks (selector, label for links/buttons, position in % of the document),
 * rage clicks (3+ on one element within a second), dead clicks (non-interactive target, no DOM
 * or URL change within 500 ms), scroll depth per page, form steps without values, visibility.
 */
export function startInteractions(client: Client, sink: InteractionSink, allowed: () => boolean) {
  let path = location.pathname;
  let depth = 0;
  const rage = new WeakMap<Element, { count: number; at: number; event?: Interaction }>();

  const base = (kind: Interaction["kind"]): Interaction => ({ ts: new Date().toISOString(), kind, path: path.slice(0, PATH_MAX) });
  const emit = (event: Interaction) => {
    if (allowed()) sink.push(event);
  };

  const measureDepth = () => {
    const doc = document.documentElement;
    const height = Math.max(doc.scrollHeight, 1);
    depth = Math.max(depth, Math.round(((window.scrollY + window.innerHeight) / height) * 100));
    depth = Math.min(depth, 100);
  };

  const flushScroll = () => {
    emit({ ...base("scroll"), depth, vw: window.innerWidth, vh: window.innerHeight });
    depth = 0;
  };

  const onPointerDown = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("#trapp-warning")) return;
    const e = event as PointerEvent;
    const doc = document.documentElement;
    const position = {
      selector: selectorFor(target),
      label: labelFor(target),
      x: pct((e.pageX / Math.max(doc.scrollWidth, window.innerWidth, 1)) * 100),
      y: pct((e.pageY / Math.max(doc.scrollHeight, 1)) * 100),
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
    emit({ ...base("click"), ...position });

    // Rage: count clicks on the same element inside a sliding one-second window.
    const now = Date.now();
    const entry = rage.get(target);
    const burst = entry && now - entry.at < RAGE_WINDOW_MS ? entry : { count: 0, at: now };
    burst.count++;
    rage.set(target, burst);
    if (burst.count === RAGE_AT) {
      burst.event = { ...base("rage"), ...position, count: burst.count };
      emit(burst.event);
      client.emit("rage", { selector: position.selector });
    } else if (burst.count > RAGE_AT && burst.event && sink.pending().includes(burst.event)) {
      burst.event.count = burst.count;
    }

    // Dead: nothing interactive under the pointer and nothing happened afterwards.
    if (!target.closest(INTERACTIVE) && typeof MutationObserver !== "undefined") {
      const href = location.href;
      let changed = false;
      const observer = new MutationObserver(() => {
        changed = true;
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      setTimeout(() => {
        observer.disconnect();
        if (!changed && location.href === href) emit({ ...base("dead"), ...position });
      }, DEAD_WAIT_MS);
    }
  };

  const formStep = (step: "focus" | "blur") => (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    if (isSensitiveField(el)) return;
    const name = el.name || el.id;
    emit({
      ...base("form"),
      selector: selectorFor(el.form ?? el),
      field: name ? name.slice(0, FIELD_MAX) : undefined,
      step,
    });
  };
  const onFocusIn = formStep("focus");
  const onFocusOut = formStep("blur");
  const onSubmit = (event: Event) => {
    if (event.target instanceof HTMLFormElement) emit({ ...base("form"), selector: selectorFor(event.target), step: "submit" });
  };

  const onScroll = () => measureDepth();
  const onVisibility = () => emit({ ...base("visibility"), state: document.visibilityState === "hidden" ? "hidden" : "visible" });
  const onHide = () => flushScroll();

  measureDepth();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("submit", onSubmit, true);
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onHide);
  const stopRoutes = watchRoutes((next) => {
    flushScroll();
    path = next;
    measureDepth();
  });

  return () =>
    safe(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      stopRoutes();
    });
}
