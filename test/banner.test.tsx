import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsentGate, ConsentProvider, useConsent, type ConsentProviderProps } from "../src";

// jsdom has no CSS animations; reduced motion makes exits unmount immediately.
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
});

function SettingsLink() {
  const { openPreferences } = useConsent();
  return <button onClick={openPreferences}>Cookie settings</button>;
}

function setup(props: Partial<ConsentProviderProps> = {}) {
  return render(
    <ConsentProvider {...props}>
      <SettingsLink />
      <ConsentGate category="marketing" fallback={<p>embed blocked</p>}>
        <p>embed visible</p>
      </ConsentGate>
    </ConsentProvider>,
  );
}

describe("CookieBanner", () => {
  it("renders into document.body and disappears after a decision", () => {
    const onChange = vi.fn();
    const { container } = setup({ onChange });

    const banner = screen.getByRole("region", { name: "We use cookies" });
    expect(container.contains(banner)).toBe(false); // portalled
    expect(screen.getByText("embed blocked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Accept all" }));

    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByText("embed visible")).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ method: "accept_all" }));
  });

  it("injects styles once, with the CSP nonce", () => {
    setup({ nonce: "abc123" });
    const styles = document.querySelectorAll("style#trapp-cc-styles");
    expect(styles).toHaveLength(1);
    expect((styles[0] as HTMLStyleElement).nonce).toBe("abc123");
  });

  it("follows the browser language with locale=auto", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ru-RU", "en"]);
    setup({ locale: "auto" });
    expect(screen.getByRole("region", { name: "Мы используем cookie" })).toBeTruthy();
  });
});

describe("PreferencesModal", () => {
  it.each([
    ["Customize", true],
    ["Customize", false],
    ["Cookie settings", true],
    ["Cookie settings", false],
  ] as const)(
    "restores focus to %s after the banner remounts (reduced motion: %s)",
    (openerName, reducedMotion) => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: reducedMotion }) as unknown as typeof window.matchMedia;
      setup();
      const opener = screen.getByRole("button", { name: openerName });
      opener.focus();
      fireEvent.click(opener);

      if (!reducedMotion) fireEvent.animationEnd(document.querySelector(".trapp-cc-banner")!);
      expect(opener.isConnected).toBe(openerName === "Cookie settings");
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);

      fireEvent.keyDown(document.activeElement!, { key: "Escape" });
      const replacement = screen.getByRole("button", { name: openerName });
      expect(document.activeElement).toBe(replacement);
      if (!reducedMotion) fireEvent.animationEnd(document.querySelector(".trapp-cc-overlay")!);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(replacement);
    },
  );

  it("traps focus, locks scroll, closes on Escape and restores focus", () => {
    setup();
    const opener = screen.getByRole("button", { name: "Cookie settings" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Cookie preferences" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    // Tab from the last focusable element wraps to the first one.
    const focusables = dialog.querySelectorAll<HTMLElement>("button");
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);
  });

  it("doesn't close when a drag starts inside the modal and ends on the overlay", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.parentElement!;

    fireEvent.mouseDown(dialog);
    fireEvent.click(overlay);
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saves a custom selection", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.click(screen.getByRole("switch", { name: "Marketing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));

    expect(screen.getByText("embed visible")).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
  });
});

describe("exit animation", () => {
  it("unmounts on animationend, not on a fixed timer", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    vi.useFakeTimers();
    try {
      setup();
      fireEvent.click(screen.getByRole("button", { name: "Reject all" }));

      const banner = document.querySelector(".trapp-cc-banner")!;
      expect(banner.classList.contains("is-exiting")).toBe(true);
      fireEvent.animationEnd(banner);
      expect(document.querySelector(".trapp-cc-banner")).toBeNull();
    } finally {
      act(() => vi.runOnlyPendingTimers());
      vi.useRealTimers();
    }
  });
});
