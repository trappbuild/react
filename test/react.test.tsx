import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrappErrorBoundary, TrappProvider, useTrapp, type Client, type TrappModule } from "../src";
import { DSN, mockFetch, removeBeacon } from "./helpers";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {}); // React logs caught errors
  delete window.__trapp;
});
afterEach(() => {
  vi.unstubAllGlobals();
  removeBeacon();
});

function Probe({ onClient }: { onClient: (c: Client) => void }) {
  onClient(useTrapp());
  return null;
}

function Bomb({ when }: { when: boolean }) {
  if (when) throw new Error("render boom");
  return <p>fine</p>;
}

describe("TrappProvider", () => {
  it("creates one client, starts modules after mount, signals the guard and stops on unmount", () => {
    mockFetch();
    const teardown = vi.fn();
    const module: TrappModule = { name: "m", setup: vi.fn(() => teardown) };
    const ready = vi.fn();
    window.__trapp = { ready };
    let client: Client | null = null;
    const { unmount, rerender } = render(
      <TrappProvider dsn={DSN} modules={[module]} consent={{ statistics: true }}>
        <Probe onClient={(c) => (client = c)} />
      </TrappProvider>,
    );
    expect(module.setup).toHaveBeenCalledTimes(1);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(client!.consent.granted()).toBe(true);
    const first = client;
    rerender(
      <TrappProvider dsn={DSN} modules={[module]} consent={{ statistics: false }}>
        <Probe onClient={(c) => (client = c)} />
      </TrappProvider>,
    );
    expect(client).toBe(first);
    expect(client!.consent.granted()).toBe(false);
    unmount();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("useTrapp throws outside a provider", () => {
    expect(() => render(<Probe onClient={() => {}} />)).toThrow(/TrappProvider/);
  });
});

describe("TrappErrorBoundary", () => {
  it("reports render errors, marks the root boundary crash and recovery, and nested ones as nested", () => {
    mockFetch();
    const crashes: boolean[] = [];
    const captured: unknown[] = [];
    const module: TrappModule = {
      name: "spy",
      setup: (client) => {
        client.on("crash", ({ recovered }) => crashes.push(recovered));
        client.on("capture", (p) => captured.push(p.context.tags));
      },
    };
    function App() {
      const [broken, setBroken] = useState(true);
      return (
        <TrappErrorBoundary fallback={({ reset }) => <button onClick={() => { setBroken(false); reset(); }}>retry</button>}>
          <TrappErrorBoundary fallback={<i>nested fallback</i>}>
            <Bomb when={broken} />
          </TrappErrorBoundary>
        </TrappErrorBoundary>
      );
    }
    render(
      <TrappProvider dsn={DSN} modules={[module]}>
        <App />
      </TrappProvider>,
    );
    // The nested boundary caught it: reported, not a crash.
    expect(screen.getByText("nested fallback")).toBeTruthy();
    expect(captured).toEqual([{ boundary: "nested" }]);
    expect(crashes).toEqual([]);
  });

  it("root boundary emits crash and recovered", () => {
    mockFetch();
    const crashes: boolean[] = [];
    const module: TrappModule = { name: "spy", setup: (client) => void client.on("crash", ({ recovered }) => crashes.push(recovered)) };
    function App() {
      const [broken, setBroken] = useState(true);
      return (
        <TrappErrorBoundary fallback={({ reset }) => <button onClick={() => { setBroken(false); reset(); }}>retry</button>}>
          <Bomb when={broken} />
        </TrappErrorBoundary>
      );
    }
    render(
      <TrappProvider dsn={DSN} modules={[module]}>
        <App />
      </TrappProvider>,
    );
    expect(crashes).toEqual([false]);
    act(() => fireEvent.click(screen.getByText("retry")));
    expect(screen.getByText("fine")).toBeTruthy();
    expect(crashes).toEqual([false, true]);
  });
});
