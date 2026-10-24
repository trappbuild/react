import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { isDev, safe } from "../core/env.js";
import { CookieBanner, type CookieBannerProps } from "./CookieBanner.js";
import { ConsentContext, type ConsentContextValue } from "./context.js";
import { parseRecord } from "./cookie.js";
import { ConsentManager } from "./manager.js";
import type { ConsentOptions, ConsentRecord, ConsentState } from "./types.js";

const ONLY_NECESSARY: ConsentState = {
  necessary: true,
  preferences: false,
  statistics: false,
  marketing: false,
};

export interface ConsentProviderProps extends ConsentOptions, CookieBannerProps {
  children?: ReactNode;
  /** Render the built-in banner. Set to false to render `<CookieBanner />` yourself. Default: true. */
  showBanner?: boolean;
  /** Called after every change: a new decision, a reset (with null), or a change from another tab. */
  onChange?: (record: ConsentRecord | null) => void;
}

export function ConsentProvider({
  children,
  showBanner = true,
  onChange,
  // banner props
  locale,
  texts,
  position,
  theme,
  privacyPolicyUrl,
  showBranding,
  nonce,
  // manager options
  ...options
}: ConsentProviderProps) {
  // Options are read once on mount — the manager owns the cookie from then on.
  const [manager] = useState(() => new ConsentManager(options));
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useWarnOnOptionChange(options);

  // The server (and hydration) sees the cookie the app passed in; the browser reads the real one.
  const [serverRecord] = useState(() => {
    const initialRecord = parseRecord(options.initialCookie);
    return initialRecord?.version === (options.version ?? 1) ? initialRecord : null;
  });
  const record = useSyncExternalStore(manager.subscribe, manager.getRecord, () => serverRecord);

  // `start()` is defensive itself; this guards the effect so an SDK bug can't unmount the app.
  useEffect(() => safe(() => manager.start()) ?? (() => {}), [manager]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(
    () => manager.subscribe(() => onChangeRef.current?.(manager.getRecord())),
    [manager],
  );

  const openPreferences = useCallback(() => setPreferencesOpen(true), []);
  const closePreferences = useCallback(() => setPreferencesOpen(false), []);

  const value = useMemo<ConsentContextValue>(() => {
    // Derived from the snapshot, not the manager, so hydration renders what the server did.
    const consent = record?.categories ?? ONLY_NECESSARY;
    return {
      record,
      consent,
      hasDecided: record !== null,
      has: (category) =>
        (Array.isArray(category) ? category : [category]).every(
          (c) => c === "necessary" || consent[c],
        ),
      acceptAll: () => {
        manager.acceptAll();
        setPreferencesOpen(false);
      },
      rejectAll: () => {
        manager.rejectAll();
        setPreferencesOpen(false);
      },
      save: (categories) => {
        manager.save(categories);
        setPreferencesOpen(false);
      },
      reset: () => manager.reset(),
      preferencesOpen,
      openPreferences,
      closePreferences,
      manager,
    };
  }, [record, preferencesOpen, manager, openPreferences, closePreferences]);

  return (
    <ConsentContext.Provider value={value}>
      {children}
      {showBanner && (
        <CookieBanner
          locale={locale}
          texts={texts}
          position={position}
          theme={theme}
          privacyPolicyUrl={privacyPolicyUrl}
          showBranding={showBranding}
          nonce={nonce}
        />
      )}
    </ConsentContext.Provider>
  );
}

const WATCHED_OPTIONS: (keyof ConsentOptions)[] = [
  "cookieName",
  "cookieDomain",
  "version",
  "expiresDays",
  "reportUrl",
  "projectId",
  "reloadOnWithdraw",
  "googleConsentMode",
];

/** Dev-only: manager options are read once, so changing them later silently does nothing. */
function useWarnOnOptionChange(options: ConsentOptions) {
  const initial = useRef(options);
  useEffect(() => {
    if (!isDev()) return;
    const changed = WATCHED_OPTIONS.filter((key) => initial.current[key] !== options[key]);
    if (changed.length) {
      console.warn(
        `[trapp] <ConsentProvider> reads ${changed.join(", ")} only on mount; ` +
          "the new value is ignored. Remount the provider (e.g. with a `key`) to apply it.",
      );
      initial.current = options;
    }
  });
}
