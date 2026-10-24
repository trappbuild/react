// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentGate, ConsentProvider } from "../src";

const cookie = encodeURIComponent(
  JSON.stringify({
    id: "x",
    version: 1,
    timestamp: "",
    method: "accept_all",
    categories: { necessary: true, preferences: true, statistics: true, marketing: true },
  }),
);

describe("server rendering", () => {
  it("uses initialCookie for gates and never renders the banner", () => {
    const html = renderToString(
      <ConsentProvider initialCookie={cookie}>
        <ConsentGate category="marketing" fallback={<span>blocked</span>}>
          <span>embed</span>
        </ConsentGate>
      </ConsentProvider>,
    );
    expect(html).toContain("embed");
    expect(html).not.toContain("trapp-cc");
  });

  it("renders fallbacks and no banner without a cookie", () => {
    const html = renderToString(
      <ConsentProvider>
        <ConsentGate category="marketing" fallback={<span>blocked</span>}>
          <span>embed</span>
        </ConsentGate>
      </ConsentProvider>,
    );
    expect(html).toContain("blocked");
    expect(html).not.toContain("trapp-cc");
  });

  it("does not grant an initial cookie from a previous policy version", () => {
    const html = renderToString(
      <ConsentProvider initialCookie={cookie} version={2}>
        <ConsentGate category="marketing" fallback={<span>blocked</span>}>
          <span>embed</span>
        </ConsentGate>
      </ConsentProvider>,
    );
    expect(html).toContain("blocked");
    expect(html).not.toContain("embed");
  });
});
