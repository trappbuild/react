import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { SDK_NAME, SDK_VERSION } from "../src/core/version";

describe("version", () => {
  it("matches package.json", () => {
    expect(SDK_VERSION).toBe(pkg.version);
    expect(SDK_NAME).toBe(pkg.name);
  });
});
