import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTableMock, type MockRow } from "@/lib/test-support/supabase-table-mock";
import type { PostingEvent, PostResult } from "@/lib/finance/posting/client";

/**
 * DAVRANIŞ TESTİ: danışman hakediş ödemesi — yetki/rol kapısı, ofis hesabı zorunluluğu, tahsil edilmemiş komisyonun
 * atlanması, çift ödeme engeli (ödenmiş pay yeniden yazılmaz), bekleyen hakedişin aynı satırda yükselmesi, kiracı süzgeci,
 * deftere stopajlı `payout.paid` kaydı (anahtar `payout:{id}`), defter yazılamazsa hakedişin "hazırlandı"da kalması ve
 * yeniden denemenin aynı anahtarla tamamlanması, denetim kaydı, danışman bildirimi ve "Kasama işle".
 */
type Mock = ReturnType<typeof createTableMock>;
let db: Mock;

const requirePermission = vi.fn();
const logActivity = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const notifyTenant = vi.fn(async (..._a: unknown[]) => undefined);
const financePost = vi.fn<(s: unknown, e: PostingEvent) => Promise<PostResult>>();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: (...a: unknown[]) => logActivity(...a) }));
vi.mock("@/lib/notify", () => ({ notifyTenant: (...a: unknown[]) => notifyTenant(...a) }));
vi.mock("@/lib/after-safe", () => ({ afterSafe: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/require-permission", () => ({ requirePermission: (...a: unknown[]) => requirePermission(...(a as [])) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));
vi.mock("@/lib/finance/posting/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/finance/posting/client")>()),
  financePost: (s: unknown, e: PostingEvent) => financePost(s, e),
}));

const T = "t1";
const ACC = "11111111-1111-4111-8111-111111111111";
const KASAM = "22222222-2222-4222-8222-222222222222";
const S1 = "a0000000-0000-4000-8000-000000000001";
const S2 = "a0000000-0000-4000-8000-000000000002";
const S3 = "a0000000-0000-4000-8000-000000000003";
const Y1 = "b0000000-0000-4000-8000-000000000001";
const Y2 = "b0000000-0000-4000-8000-000000000002";
const PAY = { accountId: ACC };

const posted = (over: Partial<PostResult> = {}): PostResult => ({
  ok: true, outcome: "posted", entryIds: ["e1"], openItemId: null, redated: false, reversed: false, message: null, ...over,
});
const gate = (role: string, userId = "boss") => ({ ok: true, tenantId: T, userId, role, impersonating: false });
const comm = (id: string, status: string, tenant = T): MockRow => ({ id, tenant_id: tenant, status });
const split = (id: string, commission: string, profile: string | null, amount: number, extra: MockRow = {}): MockRow => ({
  id, tenant_id: T, commission_id: commission, profile_id: profile, amount, kind: "advisor", unresolved: false, label: "Danışman", ...extra,
});
const office = { id: ACC, tenant_id: T, owner_scope: "office", owner_user_id: null, archived_at: null };

function setup(tables: Record<string, MockRow[]>) {
  db = createTableMock({
    commissions: [],
    commission_splits: [],
    commission_payouts: [],
    finance_accounts: [office],
    finance_open_items: [],
    profiles: [
      { id: "adv1", tenant_id: T, full_name: "Ayşe Danışman" },
      { id: "adv2", tenant_id: T, full_name: "Mehmet Danışman" },
    ],
    ...tables,
  });
}

describe("hakediş ödemesi", () => {
  beforeEach(() => {
    setup({});
    requirePermission.mockReset().mockResolvedValue(gate("owner"));
    logActivity.mockClear();
    notifyTenant.mockClear();
    financePost.mockReset().mockResolvedValue(posted());
  });

  it("yetki reddinde ve owner/gm dışı rolde (muhasebe dahil) hiçbir şey yazılmaz", async () => {
    const { payCommissionPayouts } = await import("./commission-payouts");
    requirePermission.mockResolvedValueOnce({ ok: false, error: "Bu işlem için yetkiniz yok." });
    expect(await payCommissionPayouts(["c1"], PAY)).toEqual({ error: "Bu işlem için yetkiniz yok." });
    expect(requirePermission).toHaveBeenCalledWith("commissions", "edit");
    requirePermission.mockResolvedValueOnce(gate("branch_manager"));
    expect((await payCommissionPayouts(["c1"], PAY)).error).toMatch(/ofis sahibi veya genel müdür/);
    requirePermission.mockResolvedValueOnce(gate("accounting"));
    expect((await payCommissionPayouts(["c1"], PAY)).error).toMatch(/ofis sahibi veya genel müdür/);
    expect(db.log).toHaveLength(0);
    expect(financePost).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("ofis hesabı zorunlu; kişisel/arşiv hesap ya da geçersiz stopaj reddedilir", async () => {
    setup({
      commissions: [comm("c1", "paid")],
      commission_splits: [split(S1, "c1", "adv1", 500)],
      finance_accounts: [office, { id: KASAM, tenant_id: T, owner_scope: "user", owner_user_id: "boss", archived_at: null }],
    });
    const { payCommissionPayout } = await import("./commission-payouts");
    expect((await payCommissionPayout("c1", { accountId: "" })).error).toMatch(/ofis hesabını seçin/);
    expect((await payCommissionPayout("c1", { accountId: KASAM })).error).toMatch(/ofis hesabı bulunamadı/);
    expect((await payCommissionPayout("c1", { accountId: ACC, withholdingRate: 55 })).error).toMatch(/Stopaj oranı/);
    expect((await payCommissionPayout("c1", { accountId: ACC, date: "2999-01-01" })).error).toMatch(/tarih/);
    expect(db.tables.commission_payouts).toHaveLength(0);
    expect(financePost).not.toHaveBeenCalled();
  });

  it("tahsil edilmemiş komisyonun hakedişi ödenmez", async () => {
    setup({ commissions: [comm("c1", "calculated")], commission_splits: [split(S1, "c1", "adv1", 500)] });
    const { payCommissionPayout } = await import("./commission-payouts");
    expect((await payCommissionPayout("c1", PAY)).error).toMatch(/tahsil edilmeden/);
    expect(db.tables.commission_payouts).toHaveLength(0);
    expect(financePost).not.toHaveBeenCalled();
  });

  it("danışman payları ödenir: deftere stopajlı payout.paid, onay + ödeme alanları, kiracı süzgeci, denetim ve bildirim", async () => {
    setup({
      commissions: [comm("c1", "paid"), comm("c2", "collected"), comm("cx", "paid", "other")],
      commission_splits: [
        split(S1, "c1", "adv1", 600),
        split(S2, "c2", "adv1", 400),
        split(S3, "c2", "adv2", 250),
        split("s4", "c2", null, 300, { kind: "office" }),
        split("s5", "c2", "adv3", 100, { unresolved: true }),
      ],
    });
    const { payCommissionPayouts } = await import("./commission-payouts");
    const res = await payCommissionPayouts(["c1", "c2", "cx"], { accountId: ACC, withholdingRate: 20, paymentRef: "EFT-123" });
    expect(res).toMatchObject({ ok: true, paidCount: 3, paidAmount: 1250, netAmount: 1000, withheldAmount: 250, skipped: 1 });
    expect(db.hasFilter("commissions", "eq", "tenant_id", T, "select")).toBe(true);
    expect(db.hasFilter("commission_splits", "eq", "kind", "advisor", "select")).toBe(true);
    const rows = db.tables.commission_payouts;
    expect(rows.map((r) => r.split_id).sort()).toEqual([S1, S2, S3]);
    for (const r of rows) {
      expect(r).toMatchObject({ tenant_id: T, status: "paid", approved_by: "boss", paid_by: "boss", payment_ref: "EFT-123", created_by: "boss" });
      expect(r.approved_at).toBeTruthy();
      expect(r.paid_at).toBeTruthy();
    }
    // Hakediş önce "approved" açılır (defter yazılmadan ödenmiş sayılmaz).
    expect(db.log.filter((q) => q.table === "commission_payouts" && q.kind === "insert").every((q) => (q.payload as MockRow).status === "approved")).toBe(true);
    // Defter: her hakediş için bir olay; anahtar payout:{id}; nakit = net, stopaj ayrı borç kalemi.
    expect(financePost).toHaveBeenCalledTimes(3);
    const ev = financePost.mock.calls.map((c) => c[1]).find((e) => e.sourceId === rows.find((r) => r.split_id === S1)!.id)!;
    expect(ev).toMatchObject({
      eventType: "payout.paid",
      postingKey: `payout:${String(ev.sourceId)}`,
      note: "EFT-123",
      entries: [{ accountId: ACC, amount: 480, withholdingAmount: 120, counterparty: "Ayşe Danışman" }],
      item: { amount: 120 },
    });
    expect(ev.item!.dueDate).toMatch(/^\d{4}-\d{2}-2[6-8]$/);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity.mock.calls[0]![0]).toMatchObject({
      action: "commission_payout.pay", tenantId: T, newValue: { count: 3, amount: 1250, net: 1000, withheld: 250, account_id: ACC },
    });
    expect(notifyTenant).toHaveBeenCalledTimes(2);
    expect(notifyTenant.mock.calls.map((c) => (c[0] as { userId: string }).userId).sort()).toEqual(["adv1", "adv2"]);
    expect(notifyTenant.mock.calls[0]![0]).toMatchObject({ prefKey: "commission", href: "/app/cuzdan#odenen-hakedis" });
  });

  it("stopajsız ödemede açık kalem yok; WP2 pay kalemi (split:{id}) açıksa ödeme onu kapatır", async () => {
    setup({
      commissions: [comm("c1", "paid")],
      commission_splits: [split(S1, "c1", "adv1", 600)],
      finance_open_items: [{ id: "item-1", tenant_id: T, posting_key: `split:${S1}`, amount: 600, paid_amount: 0, status: "open" }],
    });
    const { payCommissionPayout } = await import("./commission-payouts");
    expect(await payCommissionPayout("c1", PAY)).toMatchObject({ ok: true, paidCount: 1, netAmount: 600, withheldAmount: 0 });
    const ev = financePost.mock.calls[0]![1];
    expect(ev.item).toBeUndefined();
    expect(ev.entries).toEqual([expect.objectContaining({ amount: 600, settles: "item-1" })]);
    expect(ev.entries![0]!.withholdingAmount).toBeUndefined();
  });

  it("çift ödeme yok: ödenmiş pay atlanır, bekleyen hakediş aynı satırda paid olur", async () => {
    setup({
      commissions: [comm("c1", "paid")],
      commission_splits: [split(S1, "c1", "adv1", 600), split(S2, "c1", "adv2", 300)],
      commission_payouts: [
        { id: Y1, tenant_id: T, commission_id: "c1", split_id: S1, profile_id: "adv1", amount: 600, status: "paid", approved_at: "x" },
        { id: Y2, tenant_id: T, commission_id: "c1", split_id: S2, profile_id: "adv2", amount: 300, status: "pending", approved_at: null },
      ],
    });
    const { payCommissionPayout } = await import("./commission-payouts");
    const res = await payCommissionPayout("c1", PAY);
    expect(res).toMatchObject({ ok: true, paidCount: 1, paidAmount: 300 });
    expect(db.tables.commission_payouts).toHaveLength(2);
    expect(db.tables.commission_payouts.find((r) => r.id === Y2)).toMatchObject({ status: "paid", approved_by: "boss", paid_by: "boss" });
    expect(db.log.some((q) => q.table === "commission_payouts" && q.kind === "insert")).toBe(false);
    expect(financePost.mock.calls.map((c) => c[1].postingKey)).toEqual([`payout:${Y2}`]);

    // İkinci tıklama: ödenecek pay kalmadı.
    const again = await payCommissionPayout("c1", PAY);
    expect(again.error).toMatch(/Ödenecek hakediş yok/);
    expect(financePost).toHaveBeenCalledTimes(1);
  });

  it("defter yazılamazsa hakediş ödenmiş sayılmaz (hazırlandı kalır); yeniden deneme aynı anahtarla tamamlanır", async () => {
    setup({ commissions: [comm("c1", "paid")], commission_splits: [split(S1, "c1", "adv1", 600)] });
    financePost.mockResolvedValueOnce(posted({ ok: false, outcome: "period_locked", entryIds: [], message: "Bu ay kilitli; kilidi ofis sahibi ya da genel müdür açabilir." }));
    const { payCommissionPayout } = await import("./commission-payouts");
    const first = await payCommissionPayout("c1", PAY);
    expect(first.error).toMatch(/deftere yazılamadı: Bu ay kilitli/);
    expect(db.tables.commission_payouts).toHaveLength(1);
    const row = db.tables.commission_payouts[0]!;
    expect(row).toMatchObject({ status: "approved", approved_by: "boss" });
    expect(row.paid_at).toBeUndefined();
    expect(notifyTenant).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();

    // Yeniden: onaylı satır yükselir (yeni satır yok), aynı anahtar; kayıt servisi duplicate dönse de ödeme tamamlanır.
    financePost.mockResolvedValueOnce(posted({ outcome: "duplicate" }));
    const second = await payCommissionPayout("c1", PAY);
    expect(second).toMatchObject({ ok: true, paidCount: 1 });
    expect(db.tables.commission_payouts).toHaveLength(1);
    expect(db.tables.commission_payouts[0]).toMatchObject({ status: "paid", paid_by: "boss" });
    expect(financePost.mock.calls.map((c) => c[1].postingKey)).toEqual([`payout:${String(row.id)}`, `payout:${String(row.id)}`]);
  });

  it("geri alınmış ödeme kaydı (duplicate + reversed) hakedişi ödenmiş yapmaz", async () => {
    setup({
      commissions: [comm("c1", "paid")],
      commission_splits: [split(S1, "c1", "adv1", 600)],
      commission_payouts: [{ id: Y1, tenant_id: T, commission_id: "c1", split_id: S1, profile_id: "adv1", amount: 600, status: "approved", approved_at: "x" }],
    });
    financePost.mockResolvedValueOnce(posted({ outcome: "duplicate", reversed: true }));
    const { payCommissionPayout } = await import("./commission-payouts");
    expect((await payCommissionPayout("c1", PAY)).error).toMatch(/geri alınmış/);
    expect(db.tables.commission_payouts[0]!.status).toBe("approved");
  });

  it("yarışta unique ihlali (23505) 'zaten ödendi' sayılır; defter, denetim ve bildirim yazılmaz", async () => {
    setup({ commissions: [comm("c1", "paid")], commission_splits: [split(S1, "c1", "adv1", 600)] });
    const client = db.client as unknown as { from: (t: string) => Record<string, unknown> };
    const orig = client.from;
    client.from = (t: string) => {
      const b = orig(t);
      if (t === "commission_payouts") {
        b.insert = () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }) });
      }
      return b;
    };
    const { payCommissionPayout } = await import("./commission-payouts");
    const res = await payCommissionPayout("c1", PAY);
    expect(res.error).toMatch(/başka bir oturumda zaten ödendi/);
    expect(financePost).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(notifyTenant).not.toHaveBeenCalled();
  });
});

describe("Kasama işle (payout.personal)", () => {
  const paidPayout = (profile: string): MockRow => ({ id: Y1, tenant_id: T, profile_id: profile, amount: 600, status: "paid", paid_at: "2026-10-10T09:00:00Z" });
  const kasam = (owner: string): MockRow => ({ id: KASAM, tenant_id: T, owner_scope: "user", owner_user_id: owner, archived_at: null });

  beforeEach(() => {
    requirePermission.mockReset().mockResolvedValue(gate("advisor", "adv1"));
    financePost.mockReset().mockResolvedValue(posted());
  });

  it("yalnız kendi ödenmiş hakedişi, kendi kişisel hesabına; anahtar payout:{id}:personal", async () => {
    setup({ commission_payouts: [paidPayout("adv1")], finance_accounts: [office, kasam("adv1")] });
    const { recordPayoutToPersonal } = await import("./commission-payouts");
    expect(await recordPayoutToPersonal(Y1, { accountId: KASAM, amount: 480 })).toEqual({ ok: true });
    expect(requirePermission).toHaveBeenCalledWith("commissions", "view");
    expect(db.hasFilter("commission_payouts", "eq", "profile_id", "adv1", "select")).toBe(true);
    expect(financePost.mock.calls[0]![1]).toMatchObject({
      eventType: "payout.personal", postingKey: `payout:${Y1}:personal`, sourceId: Y1, date: "2026-10-10",
      entries: [{ accountId: KASAM, amount: 480 }],
    });
  });

  it("başkasının hakedişi, ofis hesabı, hakedişi aşan tutar reddedilir; tekrar 'zaten işlenmiş'", async () => {
    setup({ commission_payouts: [paidPayout("adv2")], finance_accounts: [office, kasam("adv1")] });
    const { recordPayoutToPersonal } = await import("./commission-payouts");
    expect((await recordPayoutToPersonal(Y1, { accountId: KASAM })).error).toMatch(/bulunamadı/);
    setup({ commission_payouts: [paidPayout("adv1")], finance_accounts: [office, kasam("adv1")] });
    expect((await recordPayoutToPersonal(Y1, { accountId: ACC })).error).toMatch(/kişisel hesap/);
    expect((await recordPayoutToPersonal(Y1, { accountId: KASAM, amount: 601 })).error).toMatch(/aşmamalı/);
    expect(financePost).not.toHaveBeenCalled();
    financePost.mockResolvedValueOnce(posted({ outcome: "duplicate" }));
    expect(await recordPayoutToPersonal(Y1, { accountId: KASAM })).toMatchObject({ ok: true, info: expect.stringContaining("zaten") });
    expect(financePost.mock.calls[0]![1].entries![0]!.amount).toBe(600);
  });
});
