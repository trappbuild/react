// The slice of rrweb 2.x we use, typed locally so `rrweb` stays an optional peer dependency.

export interface RrwebEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

export interface RrwebRecordOptions {
  emit: (event: RrwebEvent, isCheckout?: boolean) => void;
  checkoutEveryNms?: number;
  maskAllInputs?: boolean;
  maskInputOptions?: Record<string, boolean>;
  blockSelector?: string;
  maskTextSelector?: string;
  maskTextFn?: (text: string, element?: unknown) => string;
  inlineImages?: boolean;
  inlineStylesheet?: boolean;
  recordCanvas?: boolean;
  sampling?: Record<string, unknown>;
  slimDOMOptions?: boolean | Record<string, boolean>;
}

export interface RrwebRecord {
  (options: RrwebRecordOptions): (() => void) | undefined;
  takeFullSnapshot?: (isCheckout?: boolean) => void;
  addCustomEvent?: (tag: string, payload: unknown) => void;
}

export interface RrwebModule {
  record: RrwebRecord;
  addCustomEvent?: (tag: string, payload: unknown) => void;
}

/** Whatever a loader resolves with (ESM namespace, CJS default export…) → the module, or null. */
export function resolveRrweb(loaded: unknown): RrwebModule | null {
  const mod = loaded as { record?: unknown; default?: { record?: unknown } } | null;
  const candidate = typeof mod?.record === "function" ? mod : mod?.default;
  return candidate && typeof candidate.record === "function" ? (candidate as unknown as RrwebModule) : null;
}

/**
 * Default loader: a bare `import("rrweb")`, written so bundlers leave it alone. Pass your own
 * `loadRrweb: () => import("rrweb")` to let the bundler emit a lazy chunk from your node_modules.
 */
export function defaultLoader(): Promise<unknown> {
  const specifier = "rrweb";
  return import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
}
