import { createContext, useContext } from "react";
import type { ConsentManager } from "./manager.js";
import type { ConsentCategory, ConsentRecord, ConsentState } from "./types.js";

export interface ConsentContextValue {
  /** The stored decision, or null if the visitor hasn't made one. */
  record: ConsentRecord | null;
  /** Effective state — everything except `necessary` is false until consent is given. */
  consent: ConsentState;
  hasDecided: boolean;
  has: (category: ConsentCategory | ConsentCategory[]) => boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  save: (categories: Partial<ConsentState>) => void;
  reset: () => void;
  preferencesOpen: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
  manager: ConsentManager;
}

export const ConsentContext = createContext<ConsentContextValue | null>(null);

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used inside <ConsentProvider>");
  return ctx;
}
