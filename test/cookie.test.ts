import { describe, expect, it } from "vitest";
import { parseRecord } from "../src/consent/cookie";

const record = {
  id: "abc",
  version: 1,
  timestamp: "2026-01-01T00:00:00.000Z",
  method: "custom",
  categories: { necessary: true, preferences: false, statistics: true, marketing: false },
};

describe("parseRecord", () => {
  it("accepts both raw (URI-encoded) and decoded cookie values", () => {
    const json = JSON.stringify(record);
    expect(parseRecord(json)).toEqual(record);
    expect(parseRecord(encodeURIComponent(json))).toEqual(record);
  });

  it.each([
    ["empty", ""],
    ["undefined", undefined],
    ["not JSON", "%7Bbroken"],
    ["null categories", JSON.stringify({ ...record, categories: null })],
    ["missing category", JSON.stringify({ ...record, categories: { necessary: true } })],
    ["wrong version type", JSON.stringify({ ...record, version: "1" })],
  ])("treats %s as no decision", (_, raw) => {
    expect(parseRecord(raw)).toBeNull();
  });
});
