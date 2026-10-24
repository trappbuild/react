import {
  useEffect,
  useId,
  useInsertionEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type AnimationEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import css from "./banner.css?inline";
import { useConsent } from "./context.js";
import { resolveTexts, type ConsentLocale, type ConsentTextsOverride } from "./i18n.js";
import { Logo } from "./Logo.js";
import { CONSENT_CATEGORIES, type ConsentState } from "./types.js";

export interface CookieBannerProps {
  /** Built-in language, or "auto" to follow the browser. Default: "en". */
  locale?: ConsentLocale | "auto";
  /** Override any text, including per-category titles and descriptions. */
  texts?: ConsentTextsOverride;
  /** Default: "bottom" (full-width bar). */
  position?: "bottom" | "bottom-left" | "bottom-right";
  /** Default: "dark". Fine-tune colours with the `--trapp-cc-*` CSS variables. */
  theme?: "dark" | "light";
  privacyPolicyUrl?: string;
  /** Show the "Powered by Trapp.build" mark. Default: true. */
  showBranding?: boolean;
  /** CSP nonce for the injected `<style>` element. */
  nonce?: string;
}

const STYLE_ID = "trapp-cc-styles";

/** Safety net in case `animationend` never fires (styles overridden, tab in background). */
const EXIT_FALLBACK_MS = 1000;

const subscribeNothing = () => () => {};

/** False on the server and during hydration, true afterwards. */
function useHydrated() {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

/**
 * Keeps an element mounted after `open` turns false until its exit animation ends.
 * The consent itself is committed immediately — only the UI lingers.
 */
function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  const exiting = !open && mounted;
  return {
    mounted: open || mounted,
    exiting,
    onAnimationEnd: (e: AnimationEvent) => {
      // Ignore animations bubbling up from children (e.g. the modal inside the overlay).
      if (exiting && e.target === e.currentTarget) setMounted(false);
    },
  };
}

function useInjectedStyles(nonce: string | undefined) {
  useInsertionEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    if (nonce) style.nonce = nonce;
    style.textContent = css;
    document.head.appendChild(style);
  }, [nonce]);
}

function Branding({ label }: { label: string }) {
  return (
    <span className="trapp-cc-branding">
      {label}
      <Logo className="trapp-cc-branding-logo" />
      <span className="trapp-cc-branding-name">Trapp.build</span>
    </span>
  );
}

export function CookieBanner(props: CookieBannerProps) {
  // Client-only: the server can't know whether to show it, and its styles are injected at runtime.
  const hydrated = useHydrated();
  return hydrated ? createPortal(<BannerAndModal {...props} />, document.body) : null;
}

function BannerAndModal({
  locale = "en",
  texts: textsOverride,
  position = "bottom",
  theme = "dark",
  privacyPolicyUrl,
  showBranding = true,
  nonce,
}: CookieBannerProps) {
  useInjectedStyles(nonce);
  const { hasDecided, preferencesOpen, acceptAll, rejectAll, openPreferences } = useConsent();
  const t = resolveTexts(locale, textsOverride);
  const titleId = useId();
  const descId = useId();
  const customizeRef = useRef<HTMLButtonElement>(null);

  const banner = usePresence(!hasDecided && !preferencesOpen);
  const modal = usePresence(preferencesOpen);

  return (
    <>
      {banner.mounted && (
        <div
          className={
            `trapp-cc trapp-cc--${theme} trapp-cc-banner trapp-cc-banner--${position}` +
            (banner.exiting ? " is-exiting" : "")
          }
          role="region"
          aria-labelledby={titleId}
          aria-describedby={descId}
          aria-hidden={banner.exiting || undefined}
          onAnimationEnd={banner.onAnimationEnd}
        >
          <div className="trapp-cc-banner-text">
            <p id={titleId} className="trapp-cc-title">
              {t.title}
            </p>
            <p id={descId} className="trapp-cc-desc">
              {t.description}{" "}
              {privacyPolicyUrl && (
                <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
                  {t.privacyPolicy}
                </a>
              )}
            </p>
            {showBranding && <Branding label={t.poweredBy} />}
          </div>
          <div className="trapp-cc-actions">
            <button
              ref={customizeRef}
              type="button"
              className="trapp-cc-btn trapp-cc-btn--ghost"
              onClick={openPreferences}
            >
              {t.customize}
            </button>
            <button type="button" className="trapp-cc-btn trapp-cc-btn--secondary" onClick={rejectAll}>
              {t.rejectAll}
            </button>
            <button type="button" className="trapp-cc-btn trapp-cc-btn--primary" onClick={acceptAll}>
              {t.acceptAll}
            </button>
          </div>
        </div>
      )}

      {modal.mounted && (
        <PreferencesModal
          locale={locale}
          texts={textsOverride}
          theme={theme}
          showBranding={showBranding}
          exiting={modal.exiting}
          onAnimationEnd={modal.onAnimationEnd}
          returnFocusRef={customizeRef}
        />
      )}
    </>
  );
}

const setAll = (value: boolean): ConsentState => ({
  necessary: true,
  preferences: value,
  statistics: value,
  marketing: value,
});

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus management: moves focus in, keeps Tab inside, locks page scroll,
 * closes on Escape and gives focus back when the modal starts closing.
 */
function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onEscape: () => void,
  returnFocusRef: RefObject<HTMLElement | null>,
) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    (dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !dialog.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !dialog.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      // Opening from the banner removes its button; closing creates a new one.
      const target = previouslyFocused?.isConnected ? previouslyFocused : returnFocusRef.current;
      target?.focus();
    };
  }, [ref, active, returnFocusRef]);
}

function PreferencesModal({
  locale,
  texts: textsOverride,
  theme,
  showBranding,
  exiting,
  onAnimationEnd,
  returnFocusRef,
}: Pick<CookieBannerProps, "texts"> & {
  locale: ConsentLocale | "auto";
  theme: "dark" | "light";
  showBranding: boolean;
  exiting: boolean;
  onAnimationEnd: (e: AnimationEvent) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const { consent, acceptAll, rejectAll, save, closePreferences } = useConsent();
  const t = resolveTexts(locale, textsOverride);
  const [draft, setDraft] = useState<ConsentState>(() => ({ ...consent }));
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Close on overlay click only if the press also started there (not a text selection drag).
  const pressedOnOverlay = useRef(false);

  useModalFocus(dialogRef, !exiting, closePreferences, returnFocusRef);

  return (
    <div
      className={`trapp-cc trapp-cc--${theme} trapp-cc-overlay` + (exiting ? " is-exiting" : "")}
      onMouseDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedOnOverlay.current && e.target === e.currentTarget) closePreferences();
        pressedOnOverlay.current = false;
      }}
      onAnimationEnd={onAnimationEnd}
    >
      <div
        ref={dialogRef}
        className="trapp-cc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="trapp-cc-modal-header">
          <p id={titleId} className="trapp-cc-title">
            {t.preferencesTitle}
          </p>
          <button
            type="button"
            className="trapp-cc-close"
            aria-label={t.close}
            onClick={closePreferences}
          >
            ×
          </button>
        </div>
        <p className="trapp-cc-desc">{t.preferencesDescription}</p>

        <ul className="trapp-cc-categories">
          {CONSENT_CATEGORIES.map((category) => {
            const locked = category === "necessary";
            const checked = locked || draft[category];
            const labelId = `${titleId}-${category}`;
            return (
              <li key={category} className="trapp-cc-category">
                <div className="trapp-cc-category-text">
                  <span id={labelId} className="trapp-cc-category-title">
                    {t.categories[category].title}
                  </span>
                  <span className="trapp-cc-category-desc">
                    {t.categories[category].description}
                  </span>
                </div>
                {locked ? (
                  <span className="trapp-cc-always-on">{t.alwaysOn}</span>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-labelledby={labelId}
                    className={"trapp-cc-switch" + (checked ? " is-on" : "")}
                    onClick={() => setDraft((d) => ({ ...d, [category]: !d[category] }))}
                  >
                    <span className="trapp-cc-switch-thumb" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="trapp-cc-actions trapp-cc-actions--modal">
          <button
            type="button"
            className="trapp-cc-btn trapp-cc-btn--secondary"
            onClick={() => {
              // flip the switches too, so the closing modal reflects the choice
              setDraft(setAll(false));
              rejectAll();
            }}
          >
            {t.rejectAll}
          </button>
          <button type="button" className="trapp-cc-btn trapp-cc-btn--ghost" onClick={() => save(draft)}>
            {t.save}
          </button>
          <button
            type="button"
            className="trapp-cc-btn trapp-cc-btn--primary"
            onClick={() => {
              setDraft(setAll(true));
              acceptAll();
            }}
          >
            {t.acceptAll}
          </button>
        </div>

        {showBranding && (
          <div className="trapp-cc-modal-footer">
            <Branding label={t.poweredBy} />
          </div>
        )}
      </div>
    </div>
  );
}
