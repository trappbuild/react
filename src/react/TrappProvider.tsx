import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "../core/client.js";
import { safe } from "../core/env.js";
import type { ClientOptions } from "../core/types.js";
import { TrappContext } from "./context.js";

export interface TrappProviderProps extends ClientOptions {
  children?: ReactNode;
}

/** `consent` can be a fresh object every render; compare by content, or by identity for managers. */
function consentKey(consent: ClientOptions["consent"]): unknown {
  if (consent && typeof consent === "object" && !("subscribe" in consent)) return JSON.stringify(consent);
  return consent;
}

/**
 * Creates the client once and starts the modules after the first render (also telling the
 * `guard` snippet the app is up). Options other than `consent` are read on mount.
 */
export function TrappProvider({ children, ...options }: TrappProviderProps) {
  const [client] = useState(() => createClient(options));

  useEffect(() => {
    const stop = safe(() => client.start()) ?? (() => {});
    safe(() => window.__trapp?.ready?.());
    return stop;
  }, [client]);

  const key = consentKey(options.consent);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    safe(() => client.setConsent(options.consent));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for `options.consent`
  }, [client, key]);

  return <TrappContext.Provider value={client}>{children}</TrappContext.Provider>;
}
