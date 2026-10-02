import { describe, expect, it } from "vitest";
import { resolveSupabaseAdminKey } from "./admin";

describe("resolveSupabaseAdminKey", () => {
  it("prefers an independently rotatable secret key", () => {
    expect(resolveSupabaseAdminKey({
      SUPABASE_SECRET_KEY: "  sb_secret_new  ",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt",
    })).toBe("sb_secret_new");
  });

  it("keeps the legacy key only as a migration fallback", () => {
    expect(resolveSupabaseAdminKey({ SUPABASE_SERVICE_ROLE_KEY: " legacy-jwt " }))
      .toBe("legacy-jwt");
  });

  it("fails closed for empty values", () => {
    expect(resolveSupabaseAdminKey({
      SUPABASE_SECRET_KEY: " ",
      SUPABASE_SERVICE_ROLE_KEY: "",
    })).toBeUndefined();
  });
});
