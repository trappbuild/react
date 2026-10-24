import { warn } from "./env.js";

/** Parsed `https://<public_key>@get.trapp.build/<project_id>`. */
export interface Dsn {
  /** `https://get.trapp.build/api/<project_id>` — ingest routes hang off this. */
  endpoint: string;
  key: string;
  projectId: string;
}

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Returns null (and warns) for anything that isn't a well-formed DSN; `http:` only for localhost. */
export function parseDsn(dsn: string): Dsn | null {
  try {
    const url = new URL(dsn);
    const key = decodeURIComponent(url.username);
    const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL.has(url.hostname));
    if (!secure || !key || !projectId || projectId.includes("/") || url.search || url.hash) throw 0;
    return { endpoint: `${url.protocol}//${url.host}/api/${projectId}`, key, projectId };
  } catch {
    warn("invalid DSN", dsn);
    return null;
  }
}
