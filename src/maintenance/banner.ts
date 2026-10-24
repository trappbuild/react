import { safe } from "../core/env.js";
import type { WarningAppearance } from "../core/status.js";

/** Same pairs as the dashboard preview (front/dash/src/lib/maintenance.ts): tone → [background, text]. */
const TONES: Record<string, [string, string]> = {
  amber: ["#ff9900", "#241300"],
  red: ["#ff4d6d", "#2a0610"],
  blue: ["#4da3ff", "#031629"],
  neutral: ["#2a2c33", "#e5e7eb"],
};

export const DEFAULT_WARNING_TEXT = "Technical works are in progress — some features may be unavailable.";
export const HOST_ID = "trapp-warning";
const DISMISS_KEY = "trapp_warning_dismissed";

// bar: full-width strip; rounded/pill: float over the page with a margin — as in the dashboard preview.
const CSS =
  ":host{all:initial}.b{position:fixed;left:0;right:0;z-index:2147483000;display:flex;justify-content:space-between;gap:10px;box-sizing:border-box;padding:10px 16px;font:700 14px/1.4 system-ui,sans-serif;overflow-wrap:anywhere}" +
  ".top{top:0}.bottom{bottom:0}.rounded,.pill{left:50%;right:auto;transform:translateX(-50%);box-shadow:0 8px 24px #0007}" +
  ".rounded{width:calc(100% - 24px);border-radius:10px}.pill{max-width:calc(100% - 40px);border-radius:22px}" +
  ".rounded.top,.pill.top{top:12px}.rounded.bottom,.pill.bottom{bottom:12px}" +
  "button{all:unset;cursor:pointer;font-size:18px;line-height:1;opacity:.7}button:hover{opacity:1}";

/** Small stable hash so a new text shows the banner again after a dismissal. */
function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text: string) => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};

/**
 * The Warning banner, rendered in a Shadow DOM so the site's CSS and ours never meet.
 * Text goes in as `textContent`; tone/shape/position come from allowlists (status.ts), never
 * interpolated into styles. A dismissal is remembered per session together with the text hash.
 */
export function createWarningBanner() {
  let host: HTMLElement | null = null;

  const hide = () => {
    host?.remove();
    host = null;
  };

  const show = (warning: WarningAppearance) => {
    const text = warning.text || DEFAULT_WARNING_TEXT;
    const key = hashText(text);
    hide();
    if (warning.dismissible && safe(() => sessionStorage.getItem(DISMISS_KEY)) === key) return;

    host = document.createElement("div");
    host.id = HOST_ID;
    const banner = el("div", "");
    banner.className = `b ${warning.shape} ${warning.position}`;
    banner.setAttribute("role", "status");
    [banner.style.background, banner.style.color] = TONES[warning.tone] ?? TONES.amber;
    banner.append(el("span", `⚠ ${text}`));
    if (warning.dismissible) {
      const close = el("button", "×");
      close.setAttribute("aria-label", "Dismiss");
      close.onclick = () => {
        safe(() => sessionStorage.setItem(DISMISS_KEY, key));
        hide();
      };
      banner.append(close);
    }
    host.attachShadow({ mode: "open" }).append(el("style", CSS), banner);
    document.body.append(host);
  };

  return { show, hide };
}
