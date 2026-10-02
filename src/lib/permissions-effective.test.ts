import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEffectivePermissions } from "./permissions-effective";

const db = vi.hoisted(() => ({
  roleResult: { data: [], error: null } as { data: unknown[] | null; error: { code?: string } | null },
  userResult: { data: [], error: null } as { data: unknown[] | null; error: { code?: string } | null },
  fromCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      db.fromCalls += 1;
      const result = table === "tenant_role_permissions" ? db.roleResult : db.userResult;
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        then(resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

describe("effective permission identity boundary", () => {
  beforeEach(() => {
    db.roleResult = { data: [], error: null };
    db.userResult = { data: [], error: null };
    db.fromCalls = 0;
    vi.restoreAllMocks();
  });

  it("fails closed for missing and unknown roles", async () => {
    await expect(getEffectivePermissions(null, null)).resolves.toEqual({});
    await expect(getEffectivePermissions(null, "")).resolves.toEqual({});
    await expect(getEffectivePermissions(null, "unknown-role")).resolves.toEqual({});
  });

  it("retains the explicit advisor defaults", async () => {
    const permissions = await getEffectivePermissions(null, "advisor");
    expect(permissions.customers).toContain("view");
    expect(permissions.billing).toBeUndefined();
  });

  it("treats readonly as an immutable view-only ceiling without override queries", async () => {
    db.roleResult = {
      data: [{ module: "customers", action: "delete", allowed: true }],
      error: null,
    };
    db.userResult = {
      data: [{ module: "customers", actions: ["view", "edit", "delete"], expires_at: null }],
      error: null,
    };

    const permissions = await getEffectivePermissions(
      "55555555-5555-5555-5555-555555555555",
      "readonly",
      "66666666-6666-6666-6666-666666666666",
    );
    expect(permissions.customers).toEqual(["view"]);
    expect(permissions.customers).not.toContain("edit");
    expect(permissions.customers).not.toContain("delete");
    expect(db.fromCalls).toBe(0);
  });

  it("fails closed when the tenant role override query cannot be read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.roleResult = { data: null, error: { code: "42501" } };
    db.userResult = { data: [], error: null };

    await expect(
      getEffectivePermissions(
        "11111111-1111-1111-1111-111111111111",
        "advisor",
        "22222222-2222-2222-2222-222222222222",
      ),
    ).resolves.toEqual({});
    expect(consoleError).toHaveBeenCalledWith(
      "getEffectivePermissions query",
      expect.objectContaining({ code: "42501" }),
    );
  });

  it("fails closed when the user override query cannot be read", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.roleResult = { data: [], error: null };
    db.userResult = { data: null, error: { code: "57014" } };

    await expect(
      getEffectivePermissions(
        "33333333-3333-3333-3333-333333333333",
        "advisor",
        "44444444-4444-4444-4444-444444444444",
      ),
    ).resolves.toEqual({});
    expect(consoleError).toHaveBeenCalledWith(
      "getEffectivePermissions query",
      expect.objectContaining({ code: "57014" }),
    );
  });
});
