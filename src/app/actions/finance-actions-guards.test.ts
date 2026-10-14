import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finans server action'ları (finance-accounts, recurring-rules, finance-statement, setup-finance) ve
 * onboarding-wizard için KRİTİK YOL testi: yetki reddi, kiracı izolasyonu (RLS'in gizlediği kayıt = "bulunamadı",
 * RPC'ye hiç gidilmez), geçersiz girdi. Mock Supabase; gerçek ayrıştırıcılar çalışır.
 */
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

type Gate =
  | { ok: true; userId: string; tenantId: string; role: string; impersonating: boolean }
  | { ok: false; error: string };

const h = vi.hoisted(() => ({
  role: "owner" as string,
  denied: new Set<string>(),
  permCalls: [] as string[],
  tables: {} as Record<string, unknown>,
  rpc: vi.fn(),
  revalidate: vi.fn(),
  update: vi.fn(),
}));

function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit"]) c[m] = () => c;
  c.update = (patch: unknown) => {
    h.update(table, patch);
    return c;
  };
  c.maybeSingle = async () => ({ data: h.tables[table] ?? null, error: null });
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve({ data: h.tables[table] ?? [], error: null }).then(res, rej);
  return c;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/revalidate", () => ({ revalidateTenantData: h.revalidate }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/require-permission", () => ({
  requirePermission: async (mod: string, level: string): Promise<Gate> => {
    h.permCalls.push(`${mod}:${level}`);
    if (h.denied.has(`${mod}:${level}`)) return { ok: false, error: "Bu işlem için yetkiniz yok." };
    return { ok: true, userId: "user-1", tenantId: "tenant-1", role: h.role, impersonating: false };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => chain(t), rpc: h.rpc }),
}));

import { createFinanceAccount, recordCashEntry, setEntriesReconciled, transferBetweenAccounts, updateFinanceAccount, voidCashEntry } from "./finance-accounts";
import { approveRecurringOccurrence, createRecurringRule, deleteRecurringRule, setRecurringRuleActive } from "./recurring-rules";
import { applyStatementDecisions, discardStatementImport } from "./finance-statement";
import { saveExpensesCashSetup } from "./setup-finance";
import { saveOwnTitle, setListingPoolEnabled } from "./onboarding-wizard";

beforeEach(() => {
  vi.clearAllMocks();
  h.role = "owner";
  h.denied = new Set();
  h.permCalls = [];
  h.tables = {};
  h.rpc.mockResolvedValue({ data: {}, error: null });
});

describe("finance-accounts", () => {
  it("geçersiz hesap kimliği RPC'ye gitmeden reddedilir", async () => {
    expect((await updateFinanceAccount("abc", {})).error).toBe("Hesap bulunamadı.");
    expect((await voidCashEntry("abc", "neden yok")).error).toBe("Hareket bulunamadı.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("başka ofisin hesabı (RLS satırı gizler) bulunamaz; yetki sorgusuna bile geçilmez", async () => {
    h.tables.finance_accounts = null;
    expect((await updateFinanceAccount(UUID_A, { name: "Kasa" })).error).toBe("Hesap bulunamadı.");
    expect((await transferBetweenAccounts({ fromAccountId: UUID_A, toAccountId: UUID_B, amount: 10 })).error).toBe("Hesap bulunamadı.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("ofis hesabı yazımı expenses yetkisi ister; reddedilince RPC çağrılmaz", async () => {
    h.tables.finance_accounts = { id: UUID_A, owner_scope: "office", currency: "TRY", archived_at: null };
    h.denied.add("expenses:edit");
    expect((await updateFinanceAccount(UUID_A, { name: "Kasa" })).error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.permCalls).toContain("expenses:edit");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("kişisel hesap expenses değil dashboard:view kapısından geçer", async () => {
    h.tables.finance_accounts = { id: UUID_A, owner_scope: "user", currency: "TRY", archived_at: null };
    h.denied.add("expenses:edit");
    h.rpc.mockResolvedValue({ data: { outcome: "updated" }, error: null });
    await updateFinanceAccount(UUID_A, { name: "Cebim", openingBalance: "0" });
    expect(h.permCalls).toContain("dashboard:view");
    expect(h.permCalls).not.toContain("expenses:edit");
  });

  it("hesap açma: boş ad / yetkisiz ofis hesabı reddedilir", async () => {
    expect((await createFinanceAccount({ scope: "office", kind: "cash", name: "", currency: "TRY", openingBalance: "0" })).error).toBeTruthy();
    h.denied.add("expenses:create");
    const r = await createFinanceAccount({ scope: "office", kind: "cash", name: "Ofis kasası", currency: "TRY", openingBalance: "0", openingDate: "2020-01-01" });
    expect(r.error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("transfer: aynı hesap, farklı para birimi, geçersiz tutar reddedilir", async () => {
    h.tables.finance_accounts = { id: UUID_A, owner_scope: "office", currency: "TRY", archived_at: null };
    expect((await transferBetweenAccounts({ fromAccountId: UUID_A, toAccountId: UUID_A, amount: 10 })).error).toBe("Kaynak ve hedef hesap aynı olamaz.");
    expect((await transferBetweenAccounts({ fromAccountId: UUID_A, toAccountId: UUID_B, amount: -5 })).error).toMatch(/tutar/);
    expect((await transferBetweenAccounts({ fromAccountId: UUID_A, toAccountId: UUID_B, amount: 10, date: "2999-01-01" })).error).toMatch(/gelecekte/);
    expect((await transferBetweenAccounts({ fromAccountId: UUID_A, toAccountId: UUID_B, amount: 10, note: "x".repeat(1001) })).error).toMatch(/1000/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("iptal nedeni 3-300 karakter olmalı", async () => {
    h.tables.finance_accounts = { id: UUID_A, owner_scope: "office", currency: "TRY", archived_at: null };
    h.tables.cash_entries = { account_id: UUID_A };
    expect((await voidCashEntry(UUID_C, "ab")).error).toMatch(/en az 3/);
    expect((await voidCashEntry(UUID_C, "x".repeat(301))).error).toMatch(/300/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("iptal yetkisi 'delete' düzeyindedir", async () => {
    h.tables.finance_accounts = { id: UUID_A, owner_scope: "office", currency: "TRY", archived_at: null };
    h.tables.cash_entries = { account_id: UUID_A };
    h.denied.add("expenses:delete");
    expect((await voidCashEntry(UUID_C, "yanlış girildi")).error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("geçersiz işlem yönü ve maaş hareketinde yetkisiz rol reddedilir", async () => {
    expect((await recordCashEntry("sideways" as never, {})).error).toBe("İşlem türü geçersiz.");
    h.tables.finance_accounts = { id: UUID_A, owner_scope: "office", currency: "TRY", archived_at: null };
    h.role = "advisor";
    const r = await recordCashEntry("out", { accountId: UUID_A, amount: "1000", date: "2020-01-02", category: "maas", title: "Maaş" });
    expect(r.error).toBe("Maaş hareketlerini yalnız ofis sahibi ve genel müdür girebilir.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("RPC ham hata metnini kullanıcıya sızdırmaz", async () => {
    h.tables.finance_accounts = { id: UUID_A, owner_scope: "office", currency: "TRY", archived_at: null };
    h.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation \"cash_entries\" internal failure" } });
    const r = await recordCashEntry("in", { accountId: UUID_A, amount: "100", date: "2020-01-02", category: "diger", title: "Tahsilat" });
    if (r.error) expect(r.error).not.toMatch(/relation|internal/);
  });

  it("toplu mutabakat: geçersiz kimlikler RPC'ye gitmez, expenses:edit kapısı, sayı RPC'den gelir", async () => {
    expect((await setEntriesReconciled(["abc"], true)).error).toBe("Hareket seçin.");
    expect(h.rpc).not.toHaveBeenCalled();
    h.denied.add("expenses:edit");
    expect((await setEntriesReconciled([UUID_A], true)).error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.rpc).not.toHaveBeenCalled();
    h.denied.clear();
    h.rpc.mockResolvedValue({ data: 1, error: null });
    const r = await setEntriesReconciled([UUID_A, UUID_A, UUID_B, "x"], true);
    expect(r).toMatchObject({ ok: true, count: 1 });
    expect(h.rpc).toHaveBeenCalledWith("finance_entries_set_reconciled", { p_ids: [UUID_A, UUID_B], p_reconciled: true });
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "could not find the function" } });
    expect((await setEntriesReconciled([UUID_A], false)).error).toMatch(/kurulum bekliyor/);
  });
});

describe("recurring-rules", () => {
  it("hesap seçilmeden / bulunamayan hesapla kural kurulamaz", async () => {
    expect((await createRecurringRule({})).error).toBe("Hangi hesap olduğunu seçin.");
    h.tables.finance_accounts = null;
    expect((await createRecurringRule({ accountId: UUID_A })).error).toBe("Hesap bulunamadı.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("yetkisiz kullanıcı kural kuramaz, silemez, durduramaz", async () => {
    h.tables.finance_accounts = { owner_scope: "office" };
    h.tables.recurring_rules = { scope: "office" };
    h.denied.add("expenses:create");
    h.denied.add("expenses:edit");
    h.denied.add("expenses:delete");
    expect((await createRecurringRule({ accountId: UUID_A })).error).toBe("Bu işlem için yetkiniz yok.");
    expect((await setRecurringRuleActive(UUID_A, false)).error).toBe("Bu işlem için yetkiniz yok.");
    expect((await deleteRecurringRule(UUID_A)).error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("maaş kuralını yalnız owner/gm tanımlar", async () => {
    h.tables.finance_accounts = { owner_scope: "office" };
    h.role = "advisor";
    const r = await createRecurringRule({
      accountId: UUID_A, direction: "out", category: "maas", title: "Maaşlar", amount: "50000", frequency: "monthly", payDay: 1, mode: "auto",
    });
    expect(r.error).toBe("Maaş ödemelerini yalnız ofis sahibi ve genel müdür tanımlayabilir.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("başka kiracının kural/oluşum kimliği 'bulunamadı'; geçersiz tutar reddedilir", async () => {
    h.tables.recurring_rules = null;
    h.tables.recurring_occurrences = null;
    expect((await deleteRecurringRule(UUID_A)).error).toBe("Kayıt bulunamadı.");
    expect((await approveRecurringOccurrence(UUID_A)).error).toBe("Kayıt bulunamadı.");
    expect((await deleteRecurringRule("kotu")).error).toBe("Kayıt bulunamadı.");
    h.tables.recurring_occurrences = { rule_id: UUID_B };
    h.tables.recurring_rules = { scope: "office" };
    expect((await approveRecurringOccurrence(UUID_A, "-3")).error).toMatch(/tutar/);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("finance-statement", () => {
  it("hesap yoksa / başka ofisse karar uygulanmaz", async () => {
    h.tables.finance_accounts = null;
    expect((await applyStatementDecisions(UUID_A, [{ lineId: UUID_B, action: "skip" }])).error).toBe("Hesap bulunamadı.");
    expect((await applyStatementDecisions("kotu", [])).error).toBe("Hesap bulunamadı.");
    expect((await discardStatementImport(UUID_A, UUID_B)).error).toBe("Kayıt bulunamadı.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("yetki reddi, boş liste, 500 üstü ve geçersiz satır kimliği", async () => {
    h.tables.finance_accounts = { owner_scope: "office" };
    h.denied.add("expenses:create");
    expect((await applyStatementDecisions(UUID_A, [{ lineId: UUID_B, action: "skip" }])).error).toBe("Bu işlem için yetkiniz yok.");
    h.denied.clear();
    expect((await applyStatementDecisions(UUID_A, [])).error).toBe("Önce işlenecek satırları seçin.");
    const many = Array.from({ length: 501 }, () => ({ lineId: UUID_B, action: "skip" as const }));
    expect((await applyStatementDecisions(UUID_A, many)).error).toMatch(/500/);
    expect((await applyStatementDecisions(UUID_A, [{ lineId: "x", action: "skip" }])).error).toMatch(/geçersiz/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("hesaba ait olmayan satır (başka hesap/kiracı) taslakta bulunamaz", async () => {
    h.tables.finance_accounts = { owner_scope: "office" };
    h.tables.finance_statement_lines = []; // account_id filtresi satırı elemiş
    const r = await applyStatementDecisions(UUID_A, [{ lineId: UUID_B, action: "skip" }]);
    expect(r.error).toMatch(/bulunamadı/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("eşleştirme için hareket, düzenli ödeme için kural zorunlu; kategori yönle uyuşmalı", async () => {
    h.tables.finance_accounts = { owner_scope: "office" };
    h.tables.finance_statement_lines = [{ id: UUID_B, direction: "out" }];
    expect((await applyStatementDecisions(UUID_A, [{ lineId: UUID_B, action: "match" }])).error).toBe("Eşleştirilecek hareket seçilmemiş.");
    expect((await applyStatementDecisions(UUID_A, [{ lineId: UUID_B, action: "recurring", ruleId: "x" }])).error).toBe("Düzenli ödeme kuralı seçilmemiş.");
    expect((await applyStatementDecisions(UUID_A, [{ lineId: UUID_B, action: "bilinmeyen" as never }])).error).toBe("Geçersiz işlem.");
    expect((await applyStatementDecisions(UUID_A, [{ lineId: UUID_B, action: "create", category: "komisyon" }])).error).toMatch(/uyuşmuyor/);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("setup-finance", () => {
  it("expenses:create yoksa hiçbir şey yazılmaz", async () => {
    h.denied.add("expenses:create");
    const r = await saveExpensesCashSetup({ cashOpening: "100", accountingAmount: "500" });
    expect(r.error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("ödeme var ama yazılacak hesap yoksa açıklayıcı hata verir, kural açmaz", async () => {
    h.tables.finance_accounts = [];
    const r = await saveExpensesCashSetup({ accountingAmount: "500", sgkAmount: "1000" });
    expect(r.error).toMatch(/hesap yok/);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("boş girdi güvenli: hiçbir şey oluşmaz", async () => {
    h.tables.finance_accounts = [];
    const r = await saveExpensesCashSetup({});
    expect(r).toMatchObject({ ok: true, created: 0, skipped: 0 });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("onboarding-wizard", () => {
  it("unvan boşsa yazılmaz; yazım yalnız kendi satırı + kendi kiracısıyla yapılır", async () => {
    const empty = new FormData();
    empty.set("title", "   ");
    expect((await saveOwnTitle(empty)).error).toMatch(/Unvan/);
    expect(h.update).not.toHaveBeenCalled();
    const ok = new FormData();
    ok.set("title", "Kurucu & Gayrimenkul Danışmanı");
    expect((await saveOwnTitle(ok)).ok).toBe(true);
    expect(h.update).toHaveBeenCalledWith("profiles", { title: "Kurucu & Gayrimenkul Danışmanı" });
  });

  it("yetki reddi", async () => {
    h.denied.add("dashboard:view");
    const f = new FormData();
    f.set("title", "X");
    expect((await saveOwnTitle(f)).error).toBe("Bu işlem için yetkiniz yok.");
    h.denied.clear();
    h.denied.add("settings:edit");
    expect((await setListingPoolEnabled(true)).error).toBe("Bu işlem için yetkiniz yok.");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("havuzu yalnız owner/gm açıp kapatır", async () => {
    h.role = "advisor";
    expect((await setListingPoolEnabled(true)).error).toMatch(/yalnız ofis sahibi ve genel müdür/);
    h.role = "branch_manager";
    expect((await setListingPoolEnabled(true)).error).toMatch(/yalnız ofis sahibi/);
    expect(h.update).not.toHaveBeenCalled();
    h.role = "gm";
    h.tables.tenants = [{ id: "tenant-1" }];
    expect((await setListingPoolEnabled(true)).ok).toBe(true);
    expect(h.update).toHaveBeenCalledWith("tenants", { listing_pool_enabled: true });
  });

  it("güncellenen satır yoksa (şema/kiracı uyuşmaz) başarı dönmez", async () => {
    h.tables.tenants = [];
    expect((await setListingPoolEnabled(true)).error).toMatch(/kaydedilemedi/);
  });
});
