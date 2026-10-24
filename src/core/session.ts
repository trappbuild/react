import { hex } from "./env.js";

const KEY = "trapp_session";
let memory: string | null = null;

/**
 * Per-tab session id (16 hex chars) kept in `sessionStorage`; links errors, hits, interactions
 * and replay chunks of one visit. Falls back to memory when storage is unavailable.
 */
export function getSessionId(): string {
  if (memory) return memory;
  try {
    const stored = sessionStorage.getItem(KEY);
    if (stored && /^[0-9a-f]{16}$/.test(stored)) return (memory = stored);
    memory = hex(8);
    sessionStorage.setItem(KEY, memory);
    return memory;
  } catch {
    return (memory = hex(8));
  }
}

/** Test helper: forget the cached id so the next call reads storage again. */
export function resetSessionId() {
  memory = null;
}
