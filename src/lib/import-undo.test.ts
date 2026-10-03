import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { neutralizeFormulaCells } from "./import-sanitize";
import {
  activeRollbackClaims,
  claimWon,
  isEditedAfterImport,
  removeCreated,
  restoreUpdated,
  type RollbackLogRow,
} from "./import-undo";

const B = "11111111-1111-4111-8111-111111111111";

describe("geri alma kilidi (B4)", () => {
  const row = (action: string, claim: string, created_at: string, id: string): RollbackLogRow => ({
    id,
    action,
    created_at,
    new_value: { batch_id: B, claim },
  });

  it("en eski serbest bırakılmamış talep kazanır; eşit zamanda id sırası belirler", () => {
    const rows = [row("import.rollback", "b", "2026-01-01T00:00:00Z", "2"), row("import.rollback", "a", "2026-01-01T00:00:00Z", "1")];
    expect(claimWon(rows, B, "a")).toBe(true);
    expect(claimWon(rows, B, "b")).toBe(false);
  });
  it("serbest bırakılan talep kilidi düşürür, sonraki talep kazanır", () => {
    const rows = [
      row("import.rollback", "a", "2026-01-01T00:00:00Z", "1"),
      row("import.rollback.released", "a", "2026-01-01T00:01:00Z", "2"),
      row("import.rollback", "b", "2026-01-01T00:02:00Z", "3"),
    ];
    expect(activeRollbackClaims(rows, B)).toEqual(["b"]);
    expect(claimWon(rows, B, "b")).toBe(true);
  });
  it("eski (claim'siz) geri alma kaydı aktif sayılır", () => {
    expect(activeRollbackClaims([{ action: "import.rollback", created_at: "x", new_value: { batch_id: B } }], B)).toHaveLength(1);
  });
});

describe("isEditedAfterImport (B4)", () => {
  it("sonradan düzenlenmişse true, değilse false, belirsizse true", () => {
    expect(isEditedAfterImport("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(true);
    expect(isEditedAfterImport("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(false);
    expect(isEditedAfterImport("2025-12-31T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(false);
    expect(isEditedAfterImport("saçma", "2026-01-01T00:00:00Z")).toBe(true);
  });
});

/** Tablo → satırlar; select().in() okur, update/delete zinciri kayıt altına alır. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>, opts: { failUpdate?: boolean } = {}) {
  const updates: { table: string; patch: unknown; id?: unknown }[] = [];
  const client = {
    from(table: string) {
      const state: { op: string; patch?: unknown; filters: Record<string, unknown> } = { op: "select", filters: {} };
      const chain: Record<string, unknown> = {};
      const done = () => {
        if (state.op === "select") {
          const col = Object.keys(state.filters).find((k) => Array.isArray(state.filters[k]));
          const vals = col ? (state.filters[col] as unknown[]) : null;
          const rows = (tables[table] ?? []).filter((r) => !col || vals!.includes(r[col]));
          return { data: rows, error: null };
        }
        if (opts.failUpdate) return { data: null, error: { message: "boom" } };
        updates.push({ table, patch: state.patch, id: state.filters.id });
        const ids = Array.isArray(state.filters.id) ? (state.filters.id as string[]) : [state.filters.id as string];
        return { data: ids.map((id) => ({ id })), error: null };
      };
      for (const m of ["select", "eq", "is", "in"]) {
        chain[m] = (...a: unknown[]) => {
          if (m === "eq" || m === "in") state.filters[a[0] as string] = a[1];
          return chain;
        };
      }
      chain.select = () => chain;
      chain.update = (patch: unknown) => {
        state.op = "update";
        state.patch = patch;
        return chain;
      };
      chain.delete = () => {
        state.op = "delete";
        return chain;
      };
      chain.then = (res: (v: unknown) => unknown) => res(done());
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, updates };
}

describe("removeCreated (B4)", () => {
  it("bağlı anlaşması olan müşteriyi atlar ve raporlar", async () => {
    const db = fakeDb({ deals: [{ customer_id: "c1" }] });
    const r = await removeCreated(db.client, { target: "customers", tenantId: "t", ids: ["c1", "c2"], checkLinks: true });
    expect(r).toEqual({ removed: 1, skippedLinked: 1, failed: 0 });
  });
  it("yazma hatasını yutmaz: failed sayacı artar", async () => {
    const db = fakeDb({}, { failUpdate: true });
    const r = await removeCreated(db.client, { target: "properties", tenantId: "t", ids: ["p1", "p2"], checkLinks: false });
    expect(r.failed).toBe(2);
    expect(r.removed).toBe(0);
  });
});

describe("restoreUpdated (B4)", () => {
  it("içe aktarmadan sonra düzenlenen kaydı ezmez", async () => {
    const db = fakeDb({
      customers: [
        { id: "a", updated_at: "2026-01-01T00:00:00Z" },
        { id: "b", updated_at: "2026-01-05T00:00:00Z" },
      ],
    });
    const r = await restoreUpdated(db.client, {
      target: "customers",
      tenantId: "t",
      entries: [
        { id: "a", prev: { notes: "eski" }, importAt: "2026-01-01T00:00:00Z" },
        { id: "b", prev: { notes: "eski" }, importAt: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(r).toEqual({ restored: 1, skippedEdited: 1, failed: 0 });
    expect(db.updates).toHaveLength(1);
  });
  it("geri yükleme hatası sayılır", async () => {
    const db = fakeDb({ customers: [{ id: "a", updated_at: "2026-01-01T00:00:00Z" }] }, { failUpdate: true });
    const r = await restoreUpdated(db.client, {
      target: "customers",
      tenantId: "t",
      entries: [{ id: "a", prev: {}, importAt: "2026-01-01T00:00:00Z" }],
    });
    expect(r.failed).toBe(1);
    expect(r.restored).toBe(0);
  });
});

describe("neutralizeFormulaCells (B4/B18)", () => {
  it("formül önekli serbest metni ' ile saklar ve satırı işaretler; telefon/e-posta'ya dokunmaz", () => {
    const { rows, flaggedRows } = neutralizeFormulaCells([
      { row: 1, full_name: "=HYPERLINK(\"x\")", notes: "@cmd", phone: "+905321234567", email: "-a@b.co" },
      { row: 2, full_name: "Ayşe", notes: "normal" },
    ]);
    expect(rows[0]!.full_name).toBe("'=HYPERLINK(\"x\")");
    expect(rows[0]!.notes).toBe("'@cmd");
    expect(rows[0]!.phone).toBe("+905321234567");
    expect(rows[0]!.email).toBe("-a@b.co");
    expect(rows[1]).toEqual({ row: 2, full_name: "Ayşe", notes: "normal" });
    expect([...flaggedRows]).toEqual([1]);
  });
});
