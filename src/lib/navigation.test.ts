import { describe, expect, it } from "vitest";
import { findActiveNavigationHref } from "./navigation";

const appHrefs = [
  "/app",
  "/app/arama",
  "/app/ayarlar",
  "/app/ayarlar/filigran",
] as const;

describe("findActiveNavigationHref", () => {
  it("keeps the application root exact-only", () => {
    expect(findActiveNavigationHref("/app", appHrefs, "/app")).toBe("/app");
    expect(findActiveNavigationHref("/app/bilinmeyen", appHrefs, "/app")).toBeNull();
  });

  it("selects only the longest matching navigation target", () => {
    expect(
      findActiveNavigationHref(
        "/app/ayarlar/filigran/onizleme",
        appHrefs,
        "/app",
      ),
    ).toBe("/app/ayarlar/filigran");
  });

  it("matches complete path segments instead of similar prefixes", () => {
    expect(
      findActiveNavigationHref("/app/arama-sonuclari", appHrefs, "/app"),
    ).toBeNull();
  });

  it("tolerates trailing slashes", () => {
    expect(
      findActiveNavigationHref("/app/ayarlar/", appHrefs, "/app"),
    ).toBe("/app/ayarlar");
  });
});
