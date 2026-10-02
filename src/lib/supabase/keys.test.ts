import { describe, expect, it } from "vitest";
import { resolveSupabasePublicKey } from "./keys";

describe("resolveSupabasePublicKey", () => {
  it("prefers the independently rotatable publishable key", () => {
    expect(resolveSupabasePublicKey({
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " sb_publishable_new ",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-anon",
    })).toBe("sb_publishable_new");
  });

  it("supports the legacy anon key only as a transition fallback", () => {
    expect(resolveSupabasePublicKey({ NEXT_PUBLIC_SUPABASE_ANON_KEY: " legacy-anon " }))
      .toBe("legacy-anon");
  });
});
