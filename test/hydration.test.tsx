import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConsentGate, ConsentProvider } from "../src";

function cookie(granted: boolean, version = 1) {
  return encodeURIComponent(JSON.stringify({
    id: "hydration-test",
    version,
    timestamp: "2026-01-01T00:00:00.000Z",
    method: granted ? "accept_all" : "reject_all",
    categories: {
      necessary: true,
      preferences: granted,
      statistics: granted,
      marketing: granted,
    },
  }));
}

describe("hydration", () => {
  it.each([
    {
      name: "a returning browser without initialCookie",
      initialCookie: undefined,
      browserCookie: cookie(true),
      version: 1,
      serverText: "blocked",
      browserText: "embed",
    },
    {
      name: "consent withdrawn since the server rendered",
      initialCookie: cookie(true),
      browserCookie: undefined,
      version: 1,
      serverText: "embed",
      browserText: "blocked",
    },
    {
      name: "consent granted since the server rendered",
      initialCookie: cookie(false),
      browserCookie: cookie(true),
      version: 1,
      serverText: "blocked",
      browserText: "embed",
    },
    {
      name: "an initialCookie from an older policy",
      initialCookie: cookie(true),
      browserCookie: cookie(true, 2),
      version: 2,
      serverText: "blocked",
      browserText: "embed",
    },
  ])("preserves the server snapshot for $name", async ({
    initialCookie, browserCookie, version, serverText, browserText,
  }) => {
    const tree = (
      <ConsentProvider initialCookie={initialCookie} version={version} showBanner={false}>
        <ConsentGate category="marketing" fallback={<span>blocked</span>}>
          <span>embed</span>
        </ConsentGate>
      </ConsentProvider>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    expect(container.textContent).toBe(serverText);
    document.body.appendChild(container);
    if (browserCookie) document.cookie = `trapp_consent=${browserCookie}; path=/`;

    const onRecoverableError = vi.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree, { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.textContent).toBe(browserText);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
