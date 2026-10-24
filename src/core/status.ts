import type { Transport } from "./transport.js";

export type WarningTone = "amber" | "red" | "blue" | "neutral";
export type WarningShape = "bar" | "rounded" | "pill";

export interface WarningAppearance {
  text: string | null;
  tone: WarningTone;
  shape: WarningShape;
  position: "top" | "bottom";
  dismissible: boolean;
}

export interface RecordingSettings {
  sampleRate?: number;
  onError?: boolean;
  maskText?: boolean;
  /** A sampled session is uploaded only after this many clicks… */
  minClicks?: number;
  /** …and this many seconds of recording. */
  minDurationSec?: number;
}

/** Validated `GET /api/<project>/status` response. Unknown fields are dropped, not kept. */
export interface StatusSnapshot {
  mode: "warning" | "lockdown" | null;
  warning: WarningAppearance | null;
  maintenanceUrl: string | null;
  /** Absent keys mean "unknown" — the server has not said. */
  collection: { errors?: boolean; metrika?: boolean; recordings?: boolean };
  recordings: RecordingSettings;
  /** Polling interval in seconds, already clamped to 30–600. */
  interval: number;
}

export const DEFAULT_INTERVAL = 60;
const TEXT_MAX = 280;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (typeof v === "object" && v !== null ? (v as Raw) : {});
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const pick = <T extends string>(v: unknown, allowed: string, fallback: T): T =>
  typeof v === "string" && allowed.split(" ").includes(v) ? (v as T) : fallback;
const clamp = (v: unknown, min: number, max: number, fallback?: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== null && v !== "" ? Math.min(Math.max(n, min), max) : fallback;
};

/** Everything from the server is untrusted: every field is checked against an allowlist. */
export function parseStatus(data: unknown): StatusSnapshot | null {
  if (typeof data !== "object" || data === null) return null;
  const root = data as Raw;
  const warning = root.warning ? obj(root.warning) : null;
  const collection = obj(root.collection);
  const recordings = obj(root.recordings);
  return {
    mode: pick(root.mode, "warning lockdown", null as never),
    warning: warning
      ? {
          text: typeof warning.text === "string" ? warning.text.slice(0, TEXT_MAX) : null,
          tone: pick(warning.tone, "amber red blue neutral", "amber"),
          shape: pick(warning.shape, "bar rounded pill", "bar"),
          position: pick(warning.position, "top bottom", "top"),
          dismissible: warning.dismissible === true,
        }
      : null,
    maintenanceUrl: typeof root.maintenanceUrl === "string" ? root.maintenanceUrl : null,
    collection: { errors: bool(collection.errors), metrika: bool(collection.metrika), recordings: bool(collection.recordings) },
    recordings: {
      sampleRate: clamp(recordings.sampleRate, 0, 1),
      onError: bool(recordings.onError),
      maskText: bool(recordings.maskText),
      minClicks: clamp(recordings.minClicks, 0, 100),
      minDurationSec: clamp(recordings.minDurationSec, 0, 600),
    },
    interval: clamp(root.interval, 30, 600, DEFAULT_INTERVAL)!,
  };
}

/** One status request; null on network error, non-2xx or non-JSON. */
export async function fetchStatus(transport: Transport): Promise<StatusSnapshot | null> {
  try {
    const response = await fetch(transport.url("status"), { credentials: "omit" });
    return response.ok ? parseStatus(await response.json()) : null;
  } catch {
    return null;
  }
}
