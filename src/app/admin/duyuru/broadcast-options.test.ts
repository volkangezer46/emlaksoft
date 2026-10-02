import { describe, expect, it } from "vitest";
import { KIND_OPTIONS } from "./broadcast-options";

describe("broadcast kind options", () => {
  it("keeps the server-safe announcement kind contract complete and unique", () => {
    expect(KIND_OPTIONS.map((option) => option.value)).toEqual([
      "info",
      "success",
      "warning",
      "danger",
      "system",
    ]);
    expect(new Set(KIND_OPTIONS.map((option) => option.value)).size).toBe(KIND_OPTIONS.length);
    expect(KIND_OPTIONS.every((option) => option.label && option.cls)).toBe(true);
  });
});
