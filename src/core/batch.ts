import { devWarn } from "./env.js";
import type { Transport } from "./transport.js";

/** Bodies above this are gzipped when the browser can; small ones aren't worth a preflight. */
const GZIP_FROM = 1024;

/** The body gzipped with `CompressionStream` when available and worthwhile, else unchanged. */
export async function compress(body: string): Promise<string | Uint8Array> {
  if (body.length < GZIP_FROM || typeof CompressionStream === "undefined") return body;
  try {
    const stream = new Response(body).body!.pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return body;
  }
}

export interface BatchOptions<T> {
  path: string;
  /** Flush interval in ms. */
  every: number;
  /** Flush when this many items are queued. */
  max: number;
  /** Items beyond the cap are dropped (default 100). */
  cap?: number;
  serialize(items: T[]): string;
}

export interface Batcher<T> {
  push(item: T): void;
  /** Items waiting to be sent — mutable so callers can fold repeats into a count. */
  pending(): T[];
  flush(beacon?: boolean): void;
  stop(): void;
}

/** Collects items and posts them (gzipped when large) every `every` ms or at `max`; `pagehide` flushes with a beacon. */
export function createBatcher<T>(transport: Transport, { path, every, max, cap = 100, serialize }: BatchOptions<T>): Batcher<T> {
  let items: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (beacon = false) => {
    clearTimeout(timer);
    timer = undefined;
    if (!items.length) return;
    const body = serialize(items);
    items = [];
    if (beacon) void transport.send(path, body, { beacon });
    else void compress(body).then((packed) => transport.send(path, packed));
  };

  const batcher: Batcher<T> = {
    push(item) {
      if (items.length >= cap) return devWarn(`${path}: buffer full, dropping event`);
      items.push(item);
      if (items.length >= max) flush();
      else if (timer === undefined) timer = setTimeout(flush, every);
    },
    pending: () => items,
    flush,
    stop() {
      flush(true);
      transport.queues.delete(batcher);
    },
  };
  transport.queues.add(batcher);
  return batcher;
}
