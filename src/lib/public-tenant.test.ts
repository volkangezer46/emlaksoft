import { describe, expect, it } from "vitest";
import { isPublicTenantActive } from "@/lib/public-tenant";

describe("isPublicTenantActive", () => {
  it.each(["active", "trial", "past_due"])("allows %s tenants", (status) => {
    expect(isPublicTenantActive(status)).toBe(true);
  });

  it.each(["suspended", "cancelled", "inactive", "", null, undefined])(
    "rejects non-public lifecycle value %s",
    (status) => {
      expect(isPublicTenantActive(status)).toBe(false);
    },
  );
});
