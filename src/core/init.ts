import { createClient } from "./client.js";
import { safe } from "./env.js";
import type { Client, ClientOptions } from "./types.js";

/** Creates and starts a client in one call (non-React apps). Tells the `guard` snippet the app is up. */
export function init(options: ClientOptions): Client {
  const client = createClient(options);
  safe(() => client.start());
  safe(() => window.__trapp?.ready?.());
  return client;
}

export { createClient, getClient, captureException, captureMessage, addBreadcrumb, setUser, setTag } from "./client.js";
