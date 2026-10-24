# @trappbuild/react

Trapp.build SDK for React and the browser: **error tracking**, **availability** (Warning banner /
Lockdown redirect), **Metrika** (visits), **click recordings** (heatmaps, session replay) and a
**cookie consent banner**. One package; each module is a function, so what you don't use is not bundled.

```tsx
import { TrappProvider, TrappErrorBoundary, ConsentProvider, errors, maintenance, metrika, recordings } from "@trappbuild/react";

createRoot(root).render(
  <TrappProvider
    dsn="https://<public_key>@get.trapp.build/<project_id>"   // Settings → Keys
    release="web@2.14.0"
    environment="production"
    modules={[errors(), maintenance({ redirectOnCrash: true }), metrika(), recordings({ sampleRate: 0.1 })]}
  >
    <ConsentProvider locale="ru" privacyPolicyUrl="/privacy">
      <TrappErrorBoundary fallback={<Oops />}>
        <App />
      </TrappErrorBoundary>
    </ConsentProvider>
  </TrappProvider>,
);
```

Principles: a Trapp.build outage never breaks your site (every module fails silent); nothing is
`eval`ed or `innerHTML`ed; redirects go only to a verified origin; PII is scrubbed before it leaves
the browser; Metrika and recordings run only with **statistics** consent; errors carry no user data
until consent. Requests are `credentials: "omit"`, `text/plain` JSON (gzip when large), batched,
`sendBeacon` on `pagehide`, `Retry-After` honoured (per endpoint, capped at 1 h), at most 100 queued events.

**Browsers:** the build targets ES2019 — Safari/iOS 14+, Chrome/Android WebView 80+, Firefox 78+
(Telegram Mini Apps on older Android included). On weak devices only the light modules run: replay is
skipped automatically (see `skipWeakDevices`).

## Without React

```html
<script type="module">
  import { init, errors, maintenance, metrika } from "@trappbuild/react/browser"; // or https://cdn.trapp.build/sdk/1/browser.js
  init({ dsn: "https://<public_key>@get.trapp.build/<project_id>", modules: [errors(), maintenance(), metrika()] });
</script>
```

`init()` returns the client (`captureException`, `captureMessage`, `addBreadcrumb`, `setUser`,
`setTag`, `setConsent`); the same functions are also exported at module level and forward to the
active client. In React, `useTrapp()` returns the client.

## Modules

### `errors(options?)`

Catches `error` and `unhandledrejection` (listeners — nothing is overwritten), failed `<script>`/`<link>`
loads as `ResourceError` warnings, `<TrappErrorBoundary>` render errors, and manual `captureException` /
`captureMessage`. Stack traces (Chrome and Firefox/Safari formats) become frames with `inApp` set for
your origin outside `node_modules`. Breadcrumbs (last 50): `console.error/warn`, fetch/XHR (method,
URL without query, status, duration), clicks (selector only), route changes, tab visibility —
input values are never read. The same error within 5 s is folded into `count`. Batches of 20 or every
5 s. Limits: message 2 000 chars, 100 frames, 50 breadcrumbs, 30 tags, 64 KB per event.
Errors buffered by the `guard` snippet before the SDK loaded are picked up on start.

| Option | Default | |
|---|---|---|
| `sampleRate` | `1` | Share of errors sent |
| `ignoreErrors` | — | Strings/RegExps matched against message and frame filenames (extension and `ResizeObserver loop` noise is built in) |
| `beforeSend(event)` | — | Edit the event or return `null` to drop it |
| `captureConsole`, `captureNetwork` | `true` | Breadcrumb sources |

`setUser({ id })` is applied only after statistics consent (dropped with a dev warning otherwise).

### `maintenance(options?)`

Polls `GET /status` on load and every 60 s while the tab is visible (at once when it comes back; the
server's `interval` wins, clamped to 30–600 s). **Warning**: a banner in a Shadow DOM — text via
`textContent`, tone (`amber | red | blue | neutral`), shape (`bar | rounded | pill`), position
(`top | bottom`) and `dismissible` exactly as previewed in Manage; a dismissal is remembered for the
session together with the text hash. **Lockdown**: `location.replace(maintenanceUrl + "?from=/path")` —
only if the URL's origin is `https://maintenance.trapp.build` or your `maintenanceOrigin`; anything
else is logged and ignored. While the status is unknown the module does nothing.

| Option | Default | |
|---|---|---|
| `redirectOnCrash` | `false` | Root `<TrappErrorBoundary>` still in its fallback after 10 s → `?reason=error&from=/path` redirect, reported as a `fatal` event tagged `crash_redirect` |
| `maintenanceOrigin` | — | Extra allowed origin for your own stub |
| `maintenanceUrl` | — | Stub for crash redirects while the status is unknown (same origin check) |
| `interval` | `60` | Polling interval in seconds |

Loop protection: at most one crash redirect per 5 minutes (`sessionStorage.trapp_crash`), and none on
a `?trapp_retry=1` visit (the stub's "Retry" button).

### Guard snippet (`<head>`)

If the bundle itself fails to load, the SDK isn't there yet. Inline `dist/guard.min.js` (≈ 0.7 KB gzip):

```html
<script data-trapp-guard data-url="https://maintenance.trapp.build/<org>/<app>" data-timeout="15000">/* contents of @trappbuild/react/guard.min.js */</script>
```

It buffers early errors in `window.__trapp.buffer`, watches for failed `<script>`/`<link>` loads and
chunk-load errors, and if `TrappProvider` (or `init()`) has not called `window.__trapp.ready()` within
`data-timeout` after such a failure, redirects to `data-url?reason=error&from=…`. Same loop protection
as above; works even when Trapp.build is unreachable because the URL is baked in. Next.js:
`<Script id="trapp-guard" strategy="beforeInteractive" data-url="…">{guardSource}</Script>`.

### `metrika()`

`pageview` on load and on every route change (`pushState`/`replaceState`/`popstate` — React Router and
Next.js included), `leave` with the time on page on `pagehide` and after 30 s in a background tab. Path
without query, `referrer` and UTM as they are; the server derives the source and counts visitors with
a daily salt — no cookies, no localStorage. By default nothing is sent or buffered before statistics
consent; afterwards the current page is sent.

`metrika({ requireConsent: false })` counts every visit without waiting for the banner. Metrika stores
nothing on the device and the server keeps only a hash of IP + User-Agent with a salt that is deleted
the next day, so a site may rely on legitimate interest here — say so in your privacy policy.

### `recordings(options?)`

Two layers. **Interactions** (in the main bundle, ~2 KB): clicks with a structural selector (≤ 5
levels, no text) and, for links/buttons only, a scrubbed label ≤ 40 chars, position in % of the
document; rage clicks (3+ in a second), dead clicks (non-interactive target, nothing changed in 500 ms),
scroll depth per page, form steps (`focus`/`blur`/`submit`, field name, never the value; password and
`autocomplete="cc-*"` fields are skipped), tab visibility. Batches of 50 or every 10 s.

**Replay** (rrweb, loaded with a dynamic `import()` only with consent, when the project has recordings
enabled in `status`, and when the session is sampled). `always` mode records `sampleRate` of sessions
but uploads one only once it is worth watching — at least `minClicks` clicks and `minDurationSec` of
recording — and then from its very start; a visit that never gets there is never sent (nor kept past
4 MB in memory); a sampled visit takes one full snapshot and no periodic re-snapshots; `onError` mode keeps the last 60–120 s in memory and sends them, plus 30 s
more, when an error or rage click happens. Chunks every 5 s or 64 KB, gzip when `CompressionStream`
exists; stops after 30 min / 10 MB or when the server refuses (`429`, `409`, `404`, `413`). Settings
from the dashboard (`status.recordings`) override the options. Inputs are always masked; password and
card fields and `[data-trapp-block]` are never recorded; `[data-trapp-mask]` masks text; `maskText: true`
masks all text. Images are recorded as their URLs and loaded by the player, so a replay looks like the
real page; `blockImages: true` replaces them with placeholders (except `img[data-trapp-keep]`).

`rrweb` is an optional peer dependency. Install it and pass the loader so your bundler makes a lazy chunk:

```ts
recordings({ sampleRate: 0.1, loadRrweb: () => import("rrweb") })
```

| Option | Default | |
|---|---|---|
| `sampleRate` | `0.1` | Sessions recorded from the start |
| `onError` | `true` | Buffer and send around errors / rage clicks |
| `maskText` | `false` | Mask all page text |
| `minClicks` | `4` | Clicks before a sampled session is uploaded |
| `minDurationSec` | `10` | Seconds before a sampled session is uploaded |
| `blockImages` | `false` | Replace images with placeholders |
| `onErrorSampleRate` | `0.2` | Share of the other sessions that keep the "before the error" buffer (re-snapshot every 2 min) |
| `skipWeakDevices` | `true` | No rrweb on ≤ 2 GB memory, ≤ 2 cores, data saver or 2G/3G, nor without `CompressionStream` |
| `interactions` | `true` | The light layer |
| `loadRrweb` | bare `import("rrweb")` | How to load rrweb |

### Consent wiring

Metrika and recordings follow the **statistics** category. By default the client reads the
`trapp_consent` cookie and listens to the `trapp:consent` event, so `<ConsentProvider>` anywhere on the
page just works. With another banner pass `consent={{ statistics: true }}` (or a boolean, or a
`ConsentManager`) to `<TrappProvider>` / `init()`, or call `client.setConsent(...)` later.

## `<TrappErrorBoundary>`

`fallback` is a node or `({ error, reset }) => node`; `onError(error, info)`; `resetKeys` clear the
error when they change. The outermost boundary is the *root* one `redirectOnCrash` watches (nested
boundaries only report); override with `root`.

## Cookie consent

```tsx
import { ConsentProvider } from "@trappbuild/react";

<ConsentProvider locale="ru" privacyPolicyUrl="/privacy">
  <App />
</ConsentProvider>
```

The banner appears until the visitor decides; the decision is stored for 365 days in the first-party
`trapp_consent` cookie. Categories: `necessary` (always on), `preferences`, `statistics`, `marketing`.

### Next.js / SSR

The main entry is marked `"use client"`, so `<ConsentProvider>` and `<TrappProvider>` can be used from
a Server Component layout. Pass the cookie so `useConsent()` / `<ConsentGate>` render correctly on the server:

```tsx
import { cookies } from "next/headers";

export default async function RootLayout({ children }) {
  const consentCookie = (await cookies()).get("trapp_consent")?.value;
  return <html><body><ConsentProvider initialCookie={consentCookie}>{children}</ConsentProvider></body></html>;
}
```

Server code uses the separate entry (no React, no browser APIs):

```ts
import { parseConsentCookie, type ConsentRecord } from "@trappbuild/react/server";
```

### Block third-party scripts and iframes until consent

```html
<script type="text/plain" data-trapp-consent="statistics" src="https://mc.yandex.ru/metrika/tag.js"></script>
<script type="text/plain" data-trapp-consent="marketing,statistics">/* inline code */</script>
<script type="text/plain" data-trapp-consent="statistics" data-trapp-type="module" src="/analytics.mjs"></script>
<iframe data-trapp-consent="marketing" data-src="https://www.youtube.com/embed/…"></iframe>
```

Elements activate only when every listed category is granted. An empty or unknown category never
activates (fail closed); iframe `data-src` must be an `http(s)` URL. External scripts and following
classic inline scripts run in document order unless marked `async`; a CSP `nonce` is carried over;
elements added later (SPA navigation, `next/script`) are picked up; React-owned nodes stay in place.

### Google Consent Mode v2, gates, hook

`googleConsentMode` sends `consent default` on mount and `update` on every change. `<ConsentGate
category="marketing" fallback={…}>` renders children only with consent. `useConsent()` gives
`consent`, `has`, `hasDecided`, `acceptAll`, `rejectAll`, `save`, `openPreferences`, `reset`. Outside
React: `window.addEventListener("trapp:consent", (e) => e.detail)`.

### `<ConsentProvider>` props

| Prop | Default | |
|---|---|---|
| `locale` | `"en"` | `"en"`, `"ru"` or `"auto"` |
| `texts` | — | Override any text, incl. `categories.statistics.description` |
| `position` | `"bottom"` | `"bottom"`, `"bottom-left"`, `"bottom-right"` |
| `theme` | `"dark"` | `"dark"` or `"light"`; fine-tune with `--trapp-cc-*` CSS variables |
| `privacyPolicyUrl` | — | Link in the banner |
| `showBranding` | `true` | "Powered by Trapp.build" |
| `version` | `1` | Bump when your policy changes — everyone is asked again |
| `expiresDays` | `365` | |
| `cookieName` | `"trapp_consent"` | |
| `cookieDomain` | — | e.g. `.example.com` |
| `reportUrl` | — | Proof of consent: `https://get.trapp.build/api/<project_id>/consent?key=<public_key>` (the `?key=` is required). Body is JSON as `text/plain`: `id`, `version`, `timestamp`, `method`, `categories` (granted names), `projectId`, `url` (origin + path) |
| `projectId` | — | Sent with the report |
| `reloadOnWithdraw` | `false` | Reload when a granted category is revoked |
| `showBanner` | `true` | `false` to place `<CookieBanner />` yourself |
| `onChange` | — | `(record \| null) => void` |
| `initialCookie` | — | Raw cookie read on the server, for SSR |
| `googleConsentMode` | `false` | |
| `nonce` | — | CSP nonce for the injected `<style>` |

## Development

```bash
npm install
npm run dev        # playground at http://localhost:5180 (DSN http://pk_playground@127.0.0.1:3001/1, override with ?dsn=…)
npm run typecheck
npm test           # vitest + jsdom
npm run build      # ESM/CJS React, browser and server entries, guard.min.js, declarations, package checks
npm run size       # gzip budget: all modules ≤ 12 KB, init + maintenance ≤ 4.5 KB, guard ≤ 1 KB
```

Every push and pull request runs `.github/workflows/ci.yml` (typecheck → test → build → size).
Releases: `npm run release -- patch` bumps `package.json` and `src/core/version.ts` and tags `vX.Y.Z`; pushing the
tag runs `.github/workflows/publish.yml` (the same checks → pack check → `npm publish --ignore-scripts`).

MIT © BBWS LTD
