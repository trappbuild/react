import type { ConsentBridge, ConsentInput } from "./consent.js";
import type { Dsn } from "./dsn.js";
import type { StatusSnapshot } from "./status.js";
import type { Transport } from "./transport.js";

export type Level = "fatal" | "error" | "warning" | "info";

export interface CaptureContext {
  level?: Level;
  tags?: Record<string, string>;
  /** Overrides the error class name, e.g. `ResourceError`. */
  type?: string;
  /** Where it was caught: `onerror`, `unhandledrejection`, `boundary`, `guard`, `manual`. */
  mechanism?: string;
}

export interface Breadcrumb {
  ts: string;
  category: string;
  message: string;
  level: string;
}

/** A module is a factory result: `setup` runs on `client.start()` and may return a teardown. */
export interface TrappModule {
  name: string;
  setup(client: Client): (() => void) | void;
}

export interface ClientOptions {
  /** `https://<public_key>@get.trapp.build/<project_id>` (from Settings → Keys). */
  dsn: string;
  release?: string;
  environment?: string;
  modules?: TrappModule[];
  /** Consent source; omit to follow the `trapp_consent` cookie and `trapp:consent` event. */
  consent?: ConsentInput;
  /** Cookie name used when `consent` is omitted. Default: `trapp_consent`. */
  consentCookie?: string;
  /** Extra origin allowed for Lockdown/crash redirects besides `https://maintenance.trapp.build`. */
  maintenanceOrigin?: string;
}

/** Events modules exchange without importing each other. */
export interface ClientEvents {
  capture: { error: unknown; message?: string; context: CaptureContext };
  breadcrumb: Breadcrumb;
  /** An error event was built and queued (after sampling and ignore rules). */
  event: { level: Level; type: string; message: string };
  status: StatusSnapshot;
  /** Root error boundary caught an error (`recovered: false`) or rendered again (`true`). */
  crash: { recovered: boolean };
  rage: { selector: string };
}

export interface GuardEntry {
  type: "error" | "rejection" | "resource";
  message?: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  url?: string;
  ts?: number;
}

export interface Client {
  readonly options: ClientOptions;
  readonly dsn: Dsn | null;
  readonly transport: Transport | null;
  readonly consent: ConsentBridge;
  readonly sessionId: string;
  readonly sdk: { name: string; version: string };
  user: { id: string } | null;
  readonly tags: Record<string, string>;
  status: StatusSnapshot | null;
  /** Runs module setup once; returns a stop function. Safe to call repeatedly (StrictMode). */
  start(): () => void;
  captureException(error: unknown, context?: CaptureContext): void;
  captureMessage(message: string, context?: CaptureContext): void;
  addBreadcrumb(crumb: { category: string; message: string; level?: string }): void;
  /** Applied only while "statistics" consent is granted; dropped (with a dev warning) otherwise. */
  setUser(user: { id: string } | null): void;
  setTag(key: string, value: string): void;
  setConsent(input: ConsentInput): void;
  setStatus(status: StatusSnapshot): void;
  on<K extends keyof ClientEvents>(event: K, handler: (payload: ClientEvents[K]) => void): () => void;
  emit<K extends keyof ClientEvents>(event: K, payload: ClientEvents[K]): void;
}
