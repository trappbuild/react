import type { ReactNode } from "react";
import { useConsent } from "./context.js";
import type { ConsentCategory } from "./types.js";

export interface ConsentGateProps {
  /** Category (or categories) that must all be granted. */
  category: ConsentCategory | ConsentCategory[];
  children: ReactNode;
  /** Rendered while consent is missing, e.g. a "enable cookies to see this video" placeholder. */
  fallback?: ReactNode;
}

/** Renders children only once the visitor has granted the given categories. */
export function ConsentGate({ category, children, fallback = null }: ConsentGateProps) {
  const { has } = useConsent();
  return <>{has(category) ? children : fallback}</>;
}
