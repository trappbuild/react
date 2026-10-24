import { vi } from "vitest";
import { createClient } from "../src/core/client";
import { resetSessionId } from "../src/core/session";
import type { Client, ClientOptions, TrappModule } from "../src/core/types";

export const DSN = "https://pk_test@get.trapp.build/42";
export const ENDPOINT = "https://get.trapp.build/api/42";

export interface Sent {
  url: URL;
  init: RequestInit;
  body: string;
  json: () => unknown;
}

/** Replaces `fetch` with a recorder; bodies (also gzipped ones) are decoded to text. */
export function mockFetch(respond: (url: URL, init: RequestInit) => Response | Promise<Response> = () => new Response(null, { status: 202 })) {
  const sent: Sent[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = await decodeBody(init.body, (init.headers as Record<string, string> | undefined)?.["Content-Encoding"]);
    sent.push({ url, init, body, json: () => JSON.parse(body) });
    return respond(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return { sent, fn, calls: (path: string) => sent.filter((s) => s.url.pathname.endsWith("/" + path)) };
}

async function decodeBody(body: BodyInit | null | undefined, encoding?: string): Promise<string> {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) {
    if (encoding === "gzip") {
      const stream = new Response(body as BodyInit).body!.pipeThrough(new DecompressionStream("gzip"));
      return new Response(stream).text();
    }
    return new TextDecoder().decode(body);
  }
  if (body instanceof Blob) return body.text();
  return String(body);
}

/** `navigator.sendBeacon` recorder (jsdom has none). */
export function mockBeacon(result = true) {
  const calls: { url: string; body: string }[] = [];
  const fn = vi.fn((url: string, data?: BodyInit | null) => {
    calls.push({ url, body: data instanceof Blob ? "" : String(data) });
    if (data instanceof Blob) void data.text().then((t) => (calls[calls.length - 1].body = t));
    return result;
  });
  Object.defineProperty(navigator, "sendBeacon", { value: fn, configurable: true });
  return { calls, fn };
}

export function removeBeacon() {
  Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
}

export function makeClient(modules: TrappModule[] = [], options: Partial<ClientOptions> = {}): Client {
  resetSessionId();
  return createClient({ dsn: DSN, modules, ...options });
}

const realSetTimeout = globalThis.setTimeout;

/** Lets pending async work (fetch mocks, gzip streams) settle; real time, so it works under fake timers. */
export const flushPromises = () => new Promise<void>((r) => realSetTimeout(r, 60));

/** Fake timers that leave the microtask/immediate queue alone so async code still drains. */
export const useFakeTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });

/** Replaces `window.location` with a plain object copy so `replace`/`assign` can be observed. */
export function mockLocation(overrides: Partial<Location> = {}) {
  const original = window.location;
  const replace = vi.fn();
  const fake = { ...original, href: original.href, origin: original.origin, pathname: original.pathname, search: original.search, replace, ...overrides };
  Object.defineProperty(window, "location", { value: fake, configurable: true });
  return { replace, restore: () => Object.defineProperty(window, "location", { value: original, configurable: true }) };
}
