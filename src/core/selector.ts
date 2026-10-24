import { scrub } from "./scrub.js";
import { truncate } from "./env.js";

const MAX_LEVELS = 5;
const MAX_CLASSES = 2;
const SELECTOR_MAX = 200;
const LABEL_MAX = 40;
const ID = /^[A-Za-z_][\w-]*$/;

/** `main > section:nth-of-type(2) > button.cta` — structure only, never text or attribute values. */
export function selectorFor(element: Element | null): string {
  const parts: string[] = [];
  let el: Element | null = element;
  while (el && el.nodeType === 1 && parts.length < MAX_LEVELS && el !== document.documentElement && el !== document.body) {
    let part = el.tagName.toLowerCase();
    if (el.id && ID.test(el.id)) {
      parts.unshift(`${part}#${el.id}`);
      break;
    }
    const classes = Array.from(el.classList)
      .filter((c) => ID.test(c))
      .slice(0, MAX_CLASSES);
    if (classes.length) part += "." + classes.join(".");
    const parent: Element | null = el.parentElement;
    if (parent && parent !== document.body) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el!.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(el) + 1})`;
    }
    parts.unshift(part);
    el = parent;
  }
  return truncate(parts.join(" > "), SELECTOR_MAX);
}

/** Visible text of links and buttons only (≤ 40 chars, scrubbed); nothing else carries a label. */
export function labelFor(element: Element | null): string | undefined {
  const target = element?.closest("a, button, [role=button]");
  if (!target) return undefined;
  const text = (target.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return truncate(scrub(text), LABEL_MAX);
}

/** Fields whose values must never be touched, not even their names in a breadcrumb. */
export function isSensitiveField(element: Element | null): boolean {
  if (!(element instanceof HTMLInputElement)) return false;
  const auto = (element.getAttribute("autocomplete") ?? "").toLowerCase();
  return element.type === "password" || auto.startsWith("cc-") || auto === "one-time-code";
}
