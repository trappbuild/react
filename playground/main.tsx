import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ConsentGate,
  ConsentProvider,
  TrappErrorBoundary,
  TrappProvider,
  errors,
  maintenance,
  metrika,
  recordings,
  useConsent,
  useTrapp,
  type ConsentLocale,
} from "../src";
import logo from "../src/assets/logo.svg";

declare global {
  interface Window {
    __statsLoaded?: boolean;
    __lateLoaded?: boolean;
  }
}

/**
 * Point this at a local backend (`cd back && cargo run`, port 3001) with a frontend key of
 * project 1. The playground works without it — requests just fail quietly, as they should.
 */
const DSN = new URLSearchParams(location.search).get("dsn") ?? "http://pk_playground@127.0.0.1:3001/1";
const REPORT_URL = `${DSN.replace(/\/\/[^@]+@/, "//").replace(/\/(\w+)$/, "/api/$1")}/consent?key=${DSN.match(/\/\/([^@]+)@/)?.[1]}`;

type Locale = ConsentLocale | "auto";

const box = { background: "#101010", padding: 16, borderRadius: 8, overflow: "auto" as const };
const row = { display: "flex", gap: 8, flexWrap: "wrap" as const, marginBottom: 12 };

function Crasher({ when }: { when: boolean }) {
  if (when) throw new Error("Render crash from the playground");
  return null;
}

function TrappDemo() {
  const client = useTrapp();
  const [crash, setCrash] = useState(false);
  const [path, setPath] = useState(location.pathname);
  const [status, setStatus] = useState(client.status);
  useEffect(() => client.on("status", setStatus), [client]);

  return (
    <>
      <h2>Errors</h2>
      <div style={row}>
        <button onClick={() => { throw new Error("Thrown from a click handler"); }}>Throw in handler</button>
        <button onClick={() => void Promise.reject(new Error("Unhandled rejection"))}>Unhandled rejection</button>
        <button onClick={() => client.captureException(new RangeError("captureException"), { tags: { source: "button" } })}>captureException</button>
        <button onClick={() => client.captureMessage("captureMessage from playground", { level: "warning" })}>captureMessage</button>
        <button onClick={() => fetch("https://httpbin.org/status/500").catch(() => {})}>Failing fetch (breadcrumb)</button>
        <button onClick={() => { const s = document.createElement("script"); s.src = "/missing-chunk.js"; document.head.append(s); }}>Break an asset</button>
        <button onClick={() => client.setUser({ id: "user_42" })}>setUser (needs statistics consent)</button>
      </div>

      <h2>Maintenance</h2>
      <p>
        Status: <code>{status ? JSON.stringify({ mode: status.mode, interval: status.interval, collection: status.collection }) : "unknown (backend not reachable?)"}</code>
      </p>
      <div style={row}>
        <button onClick={() => setCrash(true)}>Crash the root boundary (redirectOnCrash after 10 s)</button>
      </div>
      <TrappErrorBoundary fallback={({ reset }) => <p>Nested fallback — <button onClick={reset}>reset</button></p>}>
        <Crasher when={crash} />
      </TrappErrorBoundary>

      <h2>Metrika &amp; recordings</h2>
      <p>Current route: <code>{path}</code> (hits, interactions and replay chunks need statistics consent)</p>
      <div style={row}>
        {["/", "/pricing", "/docs?utm_source=demo"].map((to) => (
          <button key={to} onClick={() => { history.pushState({}, "", to); setPath(location.pathname); }}>go {to}</button>
        ))}
        <button onClick={() => undefined}>Dead click (no handler effect)</button>
        <span data-trapp-mask>This text is masked in replays</span>
      </div>
      <form onSubmit={(e) => e.preventDefault()} style={row}>
        <input name="email" placeholder="email (masked in replay)" />
        <input name="password" type="password" placeholder="password (never recorded)" />
        <input name="card" autoComplete="cc-number" placeholder="card (never recorded)" />
        <button type="submit">Submit</button>
      </form>
      <img src="./favicon.png" width={32} height={32} alt="" /> <img src="./favicon.png" width={32} height={32} alt="" data-trapp-keep />
      <div style={{ height: 1200 }} />
      <p>Scroll depth is reported when you leave this page.</p>
    </>
  );
}

function ConsentDemo({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  const { record, consent, hasDecided, openPreferences, reset } = useConsent();
  const [statsLoaded, setStatsLoaded] = useState(() => !!window.__statsLoaded);
  const [lateLoaded, setLateLoaded] = useState(() => !!window.__lateLoaded);

  useEffect(() => {
    const onLoaded = () => setStatsLoaded(true);
    const onLate = () => setLateLoaded(true);
    document.addEventListener("demo:stats-loaded", onLoaded);
    document.addEventListener("demo:late-loaded", onLate);
    return () => {
      document.removeEventListener("demo:stats-loaded", onLoaded);
      document.removeEventListener("demo:late-loaded", onLate);
    };
  }, []);

  const injectLateScript = () => {
    const script = document.createElement("script");
    script.type = "text/plain";
    script.setAttribute("data-trapp-consent", "statistics");
    script.text = 'window.__lateLoaded = true; document.dispatchEvent(new Event("demo:late-loaded"));';
    document.body.append(script);
  };

  return (
    <>
      <h2>Cookie consent</h2>
      <p>
        Decided: <b>{String(hasDecided)}</b> · blocked statistics script executed: <b data-testid="stats-loaded">{String(statsLoaded)}</b> · late-injected
        script executed: <b data-testid="late-loaded">{String(lateLoaded)}</b>
      </p>
      <pre data-testid="consent-state" style={box}>{JSON.stringify({ consent, record }, null, 2)}</pre>
      <div style={row}>
        <button onClick={openPreferences}>Open preferences</button>
        <button onClick={reset}>Reset consent</button>
        <button onClick={injectLateScript}>Inject blocked script</button>
        <button onClick={() => setLocale(locale === "en" ? "ru" : locale === "ru" ? "auto" : "en")}>Locale: {locale}</button>
      </div>
      <ConsentGate category="marketing" fallback={<div data-testid="gate">🔒 Enable marketing cookies to see this embed.</div>}>
        <div data-testid="gate">✅ Marketing embed is visible.</div>
      </ConsentGate>
      <iframe data-trapp-consent="marketing" data-src="https://example.com/" title="Blocked embed" style={{ width: "100%", height: 120, border: "1px solid #333", background: "#101010", marginTop: 12 }} />
    </>
  );
}

function App() {
  const [locale, setLocale] = useState<Locale>("en");
  return (
    <TrappProvider
      dsn={DSN}
      release="playground@0.2.0"
      environment="development"
      modules={[
        errors({ ignoreErrors: [/httpbin/] }),
        maintenance({ redirectOnCrash: true, maintenanceUrl: "https://maintenance.trapp.build/playground/web" }),
        metrika(),
        recordings({ sampleRate: 1, loadRrweb: () => import("rrweb") }),
      ]}
    >
      <ConsentProvider
        locale={locale}
        privacyPolicyUrl="https://example.com/privacy"
        projectId="1"
        reportUrl={REPORT_URL}
        googleConsentMode
        onChange={(record) => console.log("[demo] consent changed", record)}
      >
        <TrappErrorBoundary fallback={({ error, reset }) => <div style={{ padding: 40 }}><h1>Something broke</h1><pre>{error.message}</pre><button onClick={reset}>Try again</button></div>}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 20px" }}>
            <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <img src={logo} alt="" width={40} height={40} style={{ borderRadius: 12, border: "1.5px solid #fff" }} />
              <span style={{ fontSize: 20, fontWeight: 700 }}>Trapp.build</span>
              <span style={{ color: "#9aa0a6" }}>SDK playground · DSN {DSN}</span>
            </header>
            <TrappDemo />
            <ConsentDemo locale={locale} setLocale={setLocale} />
          </div>
        </TrappErrorBoundary>
      </ConsentProvider>
    </TrappProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
