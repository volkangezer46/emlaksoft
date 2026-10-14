import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MATRIX } from "@/lib/permissions";

/**
 * Kiracı yalıtımı (DG4): ofis kullanıcısı yalnız KENDİ ofisinin raporlarına, kendi ofisinin kullanıcılarını alıcı
 * seçerek abone olabilir; kayıt her zaman oturumun ofisine ve kendisine yazılır. Yetkisi olmayan rapor ve destek
 * oturumu (impersonation) reddedilir.
 */

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const ME = "aaaaaaaa-1111-4111-8111-111111111111";
const MATE = "aaaaaaaa-2222-4222-8222-222222222222";
const FOREIGN = "bbbbbbbb-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;
const state: { tables: Record<string, Row[]>; inserts: { table: string; row: Row }[]; gate: Row } = { tables: {}, inserts: [], gate: {} };

function fakeDb() {
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let insert: Row | null = null;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      insert: (row: Row) => ((insert = row), q),
      then: (resolve: (v: unknown) => void) => {
        if (insert) {
          state.inserts.push({ table, row: insert });
          return resolve({ data: null, error: null });
        }
        const data = (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        resolve({ data, error: null, count: data.length });
      },
    };
    return q;
  };
  return { from };
}

vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => undefined }));
vi.mock("@/lib/platform", () => ({
  requirePlatformModule: async () => {
    throw new Error("platform kapısı beklenmiyor");
  },
}));
vi.mock("@/lib/require-permission", () => ({ requirePermission: async () => state.gate }));
vi.mock("@/lib/report-center/context", () => ({
  buildPlatformContext: () => {
    throw new Error("platform bağlamı beklenmiyor");
  },
  buildTenantContext: async (gate: { userId: string; tenantId: string; role: string }) => ({
    scope: "tenant",
    supabase: fakeDb(),
    tenantId: gate.tenantId,
    userId: gate.userId,
    role: gate.role,
    officeWide: gate.role !== "advisor",
    seeAllEarnings: gate.role !== "advisor",
    perms: DEFAULT_MATRIX[gate.role as keyof typeof DEFAULT_MATRIX],
    listScope: { kind: "none" },
    officeName: "Deniz Emlak",
    sample: { include: false, counts: { realCustomers: 0, realProperties: 0 }, seeded: false, label: null, values: [false], apply: <Q,>(q: Q) => q },
    names: new Map(),
    memo: new Map(),
    logoUrl: null,
  }),
}));

const { createReportSubscription, saveReportView } = await import("@/app/actions/report-center");

const base = {
  scope: "tenant" as const,
  reportId: "musteriler",
  name: "Haftalık müşteriler",
  format: "xlsx",
  frequency: "weekly",
  weekday: 1,
  filters: { type: "Alıcı" },
};

beforeEach(() => {
  state.inserts = [];
  state.gate = { ok: true, userId: ME, tenantId: T1, role: "owner", impersonating: false };
  state.tables = {
    profiles: [
      { id: ME, tenant_id: T1, is_active: true },
      { id: MATE, tenant_id: T1, is_active: true },
      { id: FOREIGN, tenant_id: T2, is_active: true },
    ],
    report_subscriptions: [],
    report_saved_views: [],
  };
});

describe("rapor aboneliği — kiracı yalıtımı", () => {
  it("kendi ofisinin kullanıcılarıyla abonelik oturumun ofisine ve kendisine yazılır", async () => {
    const res = await createReportSubscription({ ...base, recipientIds: [ME, MATE] });
    expect(res).toEqual({ ok: true });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      table: "report_subscriptions",
      row: { scope: "tenant", tenant_id: T1, user_id: ME, staff_id: null, report_id: "musteriler", frequency: "weekly", weekday: 1, filters: { type: "Alıcı" } },
    });
  });

  it("başka ofisin kullanıcısı alıcı seçilemez", async () => {
    const res = await createReportSubscription({ ...base, recipientIds: [ME, FOREIGN] });
    expect(res).toEqual({ ok: false, error: "Alıcılar yalnız kendi ofisinizin aktif kullanıcıları olabilir." });
    expect(state.inserts).toHaveLength(0);
  });

  it("platform raporu ofis kapsamından abone edilemez (rapor kimliği yalnız kendi kapsamından çözülür)", async () => {
    const res = await createReportSubscription({ ...base, reportId: "ofisler", recipientIds: [ME] });
    expect(res.ok).toBe(false);
    expect(state.inserts).toHaveLength(0);
  });

  it("yetkisi olmayan rapora abone olunamaz (danışman + yalnız ofis geneli rapor)", async () => {
    state.gate = { ok: true, userId: ME, tenantId: T1, role: "advisor", impersonating: false };
    const res = await createReportSubscription({ ...base, reportId: "kar-zarar", recipientIds: [ME] });
    expect(res).toEqual({ ok: false, error: "Rapor bulunamadı ya da yetkiniz yok." });
  });

  it("destek oturumu (impersonation) kayıt yapamaz; kapı reddi aynen döner", async () => {
    state.gate = { ok: true, userId: ME, tenantId: T1, role: "readonly", impersonating: true };
    expect(await createReportSubscription({ ...base, recipientIds: [ME] })).toEqual({ ok: false, error: "Destek oturumunda kayıt yapılamaz." });
    state.gate = { ok: false, error: "Bu işlem için yetkiniz yok." };
    expect(await saveReportView({ scope: "tenant", reportId: "musteriler", name: "x", filters: { type: "Alıcı" } })).toEqual({ ok: false, error: "Bu işlem için yetkiniz yok." });
    expect(state.inserts).toHaveLength(0);
  });

  it("kayıtlı görünüm doğrulanmış filtrelerle oturumun ofisine yazılır", async () => {
    const res = await saveReportView({ scope: "tenant", reportId: "musteriler", name: "Alıcılar", filters: { type: "Alıcı", sayfa: "2" }, shared: true });
    expect(res).toEqual({ ok: true });
    expect(state.inserts[0]).toMatchObject({ table: "report_saved_views", row: { tenant_id: T1, user_id: ME, filters: { type: "Alıcı" }, shared: true } });
  });
});
