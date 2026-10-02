import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rows: {} as Record<string, boolean>,
  errors: {} as Record<string, { code: string } | null>,
  queries: [] as Array<{
    table: string;
    filters: Array<[string, string, unknown]>;
  }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const query = {
        table,
        filters: [] as Array<[string, string, unknown]>,
      };
      db.queries.push(query);
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters.push(["eq", column, value]);
          return builder;
        },
        is(column: string, value: unknown) {
          query.filters.push(["is", column, value]);
          return builder;
        },
        async maybeSingle() {
          return {
            data: db.rows[table] ? { id: "found" } : null,
            error: db.errors[table] ?? null,
          };
        },
      };
      return builder;
    },
  }),
}));

import { validateTenantReferences } from "@/lib/tenant-references";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "22222222-2222-4222-8222-222222222222";
const PROPERTY = "33333333-3333-4333-8333-333333333333";
const PROFILE = "44444444-4444-4444-8444-444444444444";

describe("tenant reference boundary", () => {
  beforeEach(() => {
    db.rows = {};
    db.errors = {};
    db.queries.length = 0;
    vi.restoreAllMocks();
  });

  it("rejects malformed caller IDs before querying with service role", async () => {
    await expect(
      validateTenantReferences(TENANT, { customerId: "not-a-uuid" }),
    ).resolves.toEqual({ ok: false, error: "Seçilen ilişkili kayıt geçersiz." });
    expect(db.queries).toHaveLength(0);
  });

  it("re-resolves every relation inside the trusted tenant", async () => {
    db.rows = { customers: true, properties: true, profiles: true };

    await expect(
      validateTenantReferences(TENANT, {
        customerId: CUSTOMER,
        propertyId: PROPERTY,
        profileId: PROFILE,
      }),
    ).resolves.toEqual({ ok: true });

    expect(db.queries.map((query) => query.table)).toEqual([
      "customers",
      "properties",
      "profiles",
    ]);
    for (const query of db.queries) {
      expect(query.filters).toContainEqual(["eq", "tenant_id", TENANT]);
    }
    expect(db.queries[0].filters).toContainEqual(["is", "deleted_at", null]);
    expect(db.queries[1].filters).toContainEqual(["is", "deleted_at", null]);
    expect(db.queries[2].filters).toContainEqual(["eq", "is_active", true]);
  });

  it("does not distinguish a foreign-tenant UUID from a missing row", async () => {
    db.rows = { properties: false };
    await expect(
      validateTenantReferences(TENANT, { propertyId: PROPERTY }),
    ).resolves.toEqual({ ok: false, error: "Seçilen portföy bulunamadı." });
  });

  it("fails closed when ownership cannot be checked", async () => {
    db.errors = { customers: { code: "08006" } };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      validateTenantReferences(TENANT, { customerId: CUSTOMER }),
    ).resolves.toEqual({
      ok: false,
      error: "İlişkili kayıtlar güvenli şekilde doğrulanamadı.",
    });
    expect(consoleError).toHaveBeenCalled();
  });
});
