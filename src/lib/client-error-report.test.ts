import { describe, expect, it } from "vitest";
import { parseClientErrorReport, sanitizeClientErrorPath } from "@/lib/client-error-report";

describe("client error report boundary", () => {
  it("accepts bounded input and strips query/fragment data from local paths", () => {
    expect(
      parseClientErrorReport({
        message: "UI render failed",
        digest: "123456",
        stack: "Error: UI render failed",
        path: "/app/musteriler?email=private@example.com#details",
      }),
    ).toEqual({
      message: "UI render failed",
      digest: "123456",
      stack: "Error: UI render failed",
      path: "/app/musteriler",
    });
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "/safe\\..\\secret",
    "/safe\u0000bad",
  ])("rejects unsafe path %s", (path) => {
    expect(sanitizeClientErrorPath(path)).toBeNull();
    expect(parseClientErrorReport({ message: "x", path })).toBeNull();
  });

  it("rejects oversized fields and unknown keys", () => {
    expect(parseClientErrorReport({ message: "x".repeat(501) })).toBeNull();
    expect(parseClientErrorReport({ message: "x", tenantId: "attacker-controlled" })).toBeNull();
  });
});
