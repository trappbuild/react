export interface Frame {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
  inApp: boolean;
}

export const MAX_FRAMES = 100;

// Chrome/Edge: "    at fn (https://x/y.js:1:2)" or "    at https://x/y.js:1:2"
const CHROME = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
// Firefox/Safari: "fn@https://x/y.js:1:2" or "@https://x/y.js:1:2"
const GECKO = /^(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/;

function inApp(filename: string): boolean {
  if (typeof location === "undefined") return false;
  return filename.startsWith(location.origin) && !filename.includes("/node_modules/");
}

/** Parses a browser stack string into frames, innermost first; unknown lines are skipped. */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n")) {
    if (frames.length >= MAX_FRAMES) break;
    const m = CHROME.exec(line) ?? GECKO.exec(line);
    if (!m) continue;
    const filename = m[2].replace(/^\(|\)$/g, "");
    if (filename === "<anonymous>" || filename.startsWith("native")) continue;
    frames.push({
      filename,
      function: (m[1] ?? "").replace(/^async\s+/, "").trim() || "?",
      lineno: Number(m[3]),
      colno: Number(m[4]),
      inApp: inApp(filename),
    });
  }
  return frames;
}
