import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("gider bütçesi / tekrar / portal sözleşmesi", () => {
  const sql = read("supabase/migrations/20261008000700_expense_budgets_recurring_portal.sql");

  it("migration: RLS açık, politikalar tenant + izin kapılı, rollback çifti var", () => {
    expect(sql).toMatch(/alter table public\.expense_budgets enable row level security/);
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(sql).toMatch(new RegExp(`create policy expense_budgets_${op} on public\\.expense_budgets`));
    }
    expect(sql).toContain("current_active_tenant_id()");
    expect(sql).toContain("has_effective_permission('expenses', 'edit')");
    expect(sql).toMatch(/revoke all on table public\.expense_budgets from public, anon, authenticated/);
    expect(fs.existsSync(path.join(root, "supabase/rollbacks/20261008000700_expense_budgets_recurring_portal.rollback.sql"))).toBe(true);
  });

  it("migration: yeni sütunlar null'lanabilir ve kapalı değer listeli (mevcut satırlar değişmez)", () => {
    expect(sql).toMatch(/add column if not exists recurrence text/);
    expect(sql).toMatch(/add column if not exists portal_key text/);
    expect(sql).not.toMatch(/recurrence text not null/);
    expect(sql).toContain("'monthly', 'quarterly', 'yearly'");
    expect(sql).toContain("'sahibinden', 'hepsiemlak', 'zingat', 'emlakjet'");
  });

  it("bütçe action'ı yetki kapılı ve kategoriyi tanım listesinden doğrular", () => {
    const src = read("src/app/actions/expense-budgets.ts");
    expect(src.match(/await requirePermission\("expenses", "edit"\)/g)?.length).toBe(1);
    expect(src).toContain('getDefinitionsOrDefault("expense_category")');
    expect(src).toContain("tenant_id: gate.tenantId");
  });

  it("gider action'ları yeni sütunları yalnız doluyken yazar (şema yokken eski akış çalışır)", () => {
    const src = read("src/app/actions/expenses.ts");
    // WP5: eski gider tablosu donduruldu (ekleme yok); düzenleme portal sütununu yalnız formda varsa yazar.
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).toContain("...(fin.value.hasPortal ? { portal_key: fin.value.portalKey } : {})");
    // Konsey #13+#18: düzenli ödemenin TEK giriş yolu recurring_rules; expenses.recurrence yeni yazılmaz.
    expect(src).not.toMatch(/recurrence:\s*fin\.value/);
    expect(read("src/app/app/giderler/expense-edit-dialog.tsx")).not.toContain('name="recurrence"');
    // liste okuması şema yoksa eski sütunlarla yeniden denenir
    expect(src).toContain("isMissingFinanceSchema(error)");
  });

  it("içgörü kuralları: gider kuralları yalnız yönetim alıcılı, gelir kuralları kullanıcı alıcılı; LLM yok", () => {
    const finance = read("src/lib/insights/rules/finance.ts");
    expect(finance).not.toMatch(/audience: \{ type: "user"/);
    expect(finance.match(/audience: \{ type: "management"/g)?.length).toBeGreaterThanOrEqual(4);
    const revenue = read("src/lib/insights/rules/revenue.ts");
    expect(revenue).not.toMatch(/type: "management"/);
    for (const f of ["src/lib/insights/rules/finance.ts", "src/lib/insights/rules/revenue.ts", "src/lib/insights/revenue-facts.ts", "src/lib/finance/load.ts"]) {
      expect(read(f)).not.toMatch(/openai|api\.openai\.com/i);
    }
  });

  it("olgu yükleyicileri örnek veriyi dışarıda bırakır ve tenant süzgeci taşır", () => {
    for (const f of ["src/lib/insights/revenue-facts.ts", "src/lib/finance/load.ts"]) {
      const src = read(f);
      expect(src).toContain('.eq("tenant_id", tenantId)');
      expect(src).toContain('.eq("is_sample", false)');
    }
  });
});

describe("finans v2 (FN1) sözleşmesi: şema, RPC, taşıma, action, okuyucu", () => {
  const schema = read("supabase/migrations/20261014001000_finance_ledger_v2.sql");
  const rpc = read("supabase/migrations/20261014001100_finance_ledger_v2_rpc.sql");
  const backfill = read("supabase/migrations/20261014001200_finance_ledger_v2_backfill.sql");
  const code = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const TABLES = [
    "finance_parties", "finance_open_items", "finance_attachments", "finance_categories", "finance_rules",
    "finance_period_locks", "finance_budgets", "finance_settings", "finance_saved_views",
  ];
  const RPCS = [
    "finance_record_entry_v2(p jsonb)", "finance_update_entry_v2(p_entry_id uuid, p jsonb)", "finance_adopt_legacy_expenses(p_account_id uuid, p_ids uuid[])",
    "finance_party_upsert(p jsonb)", "finance_party_set_archived(p_id uuid, p_archived boolean)", "finance_party_balances(p_kind text default null, p_q text default null)",
    "finance_party_statement(p_party_id uuid", "finance_open_item_create(p jsonb)", "finance_open_item_cancel(p_id uuid, p_reason text)",
    "finance_open_item_settle(p_id uuid, p_account_id uuid", "finance_aging(p_direction text)", "finance_overview(p_from date, p_to date, p_rates jsonb",
    "finance_cashflow_forecast(p_days integer, p_rates jsonb", "finance_pnl(p_from date, p_to date)", "finance_vat_summary(p_from date, p_to date)",
    "finance_category_upsert(p jsonb)", "finance_category_archive(p_id uuid)", "finance_rule_upsert(p jsonb)", "finance_rule_delete(p_id uuid)",
    "finance_rule_suggest(p_text text, p_amount numeric, p_iban_last4 text, p_direction text)", "finance_period_lock(p_month date, p_note text",
    "finance_period_unlock(p_month date)", "finance_budget_set(p_month date, p_direction text, p_category text, p_amount numeric)",
    "finance_budget_vs_actual(p_month date)", "finance_attachment_register(p_storage_path text, p_file_name text, p_file_type text,",
    "finance_attachment_link(p_id uuid, p_entry_id uuid", "finance_attachment_set_ocr(p_id uuid, p_status text, p_json jsonb", "finance_settings_save(p jsonb)",
  ];

  it("yeni tablolar: RLS açık, okuma tenant + expenses:view, istemciye yazma yok (kayıtlı görünüm hariç, o da kendi satırı)", () => {
    for (const t of TABLES) {
      expect(schema, t).toContain(`alter table public.${t} enable row level security`);
      expect(schema, t).toMatch(new RegExp(`create policy ${t}_select on public\\.${t}`));
      expect(schema, t).toMatch(new RegExp(`revoke all on public\\.${t} from public, anon, authenticated`));
    }
    expect(schema.match(/has_effective_permission\('expenses', 'view'\)/g)?.length).toBeGreaterThanOrEqual(8);
    expect(code(schema)).not.toMatch(/grant (insert|update|delete|all)[^;]*finance_(parties|open_items|attachments|categories|rules|period_locks|budgets|settings)\b[^;]*to authenticated/);
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(schema).toMatch(new RegExp(`create policy finance_saved_views_${op}[\\s\\S]*?user_id = \\(select auth\\.uid\\(\\)\\)`));
    }
  });

  it("cash_entries / recurring_rules kolonları null'lanabilir; eski satıra varsayılan yazılmaz; görünümler security_invoker", () => {
    for (const col of ["party_id", "vat_rate", "vat_amount", "vat_included", "withholding_rate", "withholding_amount", "property_id", "open_item_id"]) {
      expect(schema).toMatch(new RegExp(`alter table public\\.cash_entries add column if not exists ${col} [^;]*;`));
    }
    expect(schema).not.toMatch(/add column if not exists vat_included boolean[^;]*default/);
    expect(schema).not.toMatch(/alter table public\.(cash_entries|recurring_rules) add column[^;]*not null/);
    for (const col of ["party_id", "vat_rate", "withholding_rate"]) expect(schema).toContain(`alter table public.recurring_rules add column if not exists ${col}`);
    expect(schema).toMatch(/create or replace view public\.finance_ledger_v\s+with \(security_invoker = true\)/);
    expect(schema).toMatch(/create or replace view public\.finance_open_items_v\s+with \(security_invoker = true\)/);
    expect(schema).toContain("'legacy_expense'::text");
    for (const src of ["'manual'", "'rent'", "'commission'", "'recurring'", "'owner_payout'"]) expect(schema).toContain(src);
  });

  it("ay kilidi tetiği DONEM_KILITLI ile reddeder; kilit açma yalnız owner/gm", () => {
    expect(schema).toContain("raise exception 'DONEM_KILITLI'");
    expect(schema).toContain("before insert or update on public.cash_entries");
    expect(schema).toContain("before insert or update on public.finance_open_items");
    expect(rpc).toMatch(/function public\.finance_period_unlock[\s\S]*?if not public\.finance_is_owner_gm\(\) then perform public\.finance_v2_raise\('forbidden'\)/);
  });

  it("sözleşmedeki tüm RPC'ler SECURITY DEFINER + search_path='' ve anon'a kapalı; eski RPC'ler yeniden tanımlanmaz", () => {
    for (const sig of RPCS) expect(rpc, sig).toContain(`create or replace function public.${sig}`);
    const fns = rpc.split(/(?=create or replace function )/).slice(1);
    for (const f of fns) {
      const head = f.slice(0, f.indexOf("as $$"));
      if (/security definer/.test(head)) expect(head).toContain("set search_path = ''");
      const name = /function public\.([a-z0-9_]+)\(/.exec(f)![1]!;
      expect(rpc, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`));
    }
    for (const sig of RPCS) {
      const name = sig.slice(0, sig.indexOf("("));
      expect(rpc, name).toMatch(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?security definer`));
    }
    for (const old of ["finance_record_entry(", "finance_update_entry(", "finance_transfer(", "finance_void_entry(", "finance_account_balances("]) {
      expect(code(rpc + schema + backfill)).not.toContain(`create or replace function public.${old}`);
    }
    expect(rpc).toContain("v_res := public.finance_record_entry(");
    expect(rpc).toContain("v_res := public.finance_update_entry(");
  });

  it("veri taşıma: sahte KDV yazmaz, tutar/tarih/hesap değiştirmez, idempotent; muhasebeye delete vermez", () => {
    const c = code(backfill);
    expect(c).not.toMatch(/vat_(rate|amount|included)\s*=/);
    expect(c).not.toMatch(/set\s+(amount|entry_date|account_id|direction)\s*=/);
    expect(c).toContain("where e.party_id is null");
    expect(c).toContain("on conflict do nothing");
    expect(c).toContain("('accounting', 'expenses', 'create'), ('accounting', 'expenses', 'edit')");
    expect(c).not.toContain("'delete'");
    for (const f of ["20261014001000_finance_ledger_v2", "20261014001100_finance_ledger_v2_rpc", "20261014001200_finance_ledger_v2_backfill"]) {
      expect(fs.existsSync(path.join(root, `supabase/rollbacks/${f}.rollback.sql`)), f).toBe(true);
    }
  });

  it("action'lar: her biri expenses kapılı, RPC ile yazar, /app/giderler'i tazeler; ay kilidi Türkçe mesaja çevrilir", () => {
    const src = read("src/app/actions/finance-ledger.ts");
    expect(src.startsWith('"use server"')).toBe(true);
    const exported = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual([
      "adoptLegacyExpenses", "archiveCategory", "archiveParty", "cancelOpenItem", "createOpenItem", "deleteRule", "deleteView",
      "linkAttachment", "lockPeriod", "recordEntryV2", "registerAttachment", "saveSettings", "saveView", "setBudget", "settleOpenItem",
      "unlockPeriod", "updateEntryV2", "upsertCategory", "upsertParty", "upsertRule",
    ]);
    expect(src).not.toMatch(/^export (const|let|function) /m);
    const bodies = src.split(/(?=export async function )/).slice(1);
    for (const b of bodies) {
      expect(b, b.slice(0, 60)).toMatch(/await requirePermission\("expenses", /);
      expect(b, b.slice(0, 60)).toMatch(/revalidateTenantData\(gate\.tenantId, (PATHS|\["\/app\/giderler"\])\)/);
    }
    expect(src).toContain('const PATHS = ["/app/giderler"');
    expect(src).toContain('msg.includes("DONEM_KILITLI")');
    expect(src).toContain("parsePhoneStrict(");
    expect(src).not.toMatch(/createAdminClient|service_role/);
    expect(src).not.toMatch(/\.from\("(cash_entries|finance_(parties|open_items|attachments|categories|rules|period_locks|budgets|settings))"\)\.(insert|update|delete|upsert)/);
  });

  it("okuyucular sunucuya özel, tek RPC/select yapar; vat.ts saf; izin ve realtime listesi güncel", () => {
    const load = read("src/lib/finance/ledger/load.ts");
    expect(load.startsWith('import "server-only";')).toBe(true);
    for (const fn of [
      "loadOverview", "loadForecast", "loadUpcoming", "loadParties", "loadPartyStatement", "loadOpenItems", "loadAging", "loadLedgerPage",
      "loadCategories", "loadRules", "loadBudgetVsActual", "loadVatSummary", "loadPnl", "loadAttachments", "loadSettings", "loadPeriodLocks",
      "loadSavedViews", "fxRatesForFinance",
    ]) expect(load, fn).toMatch(new RegExp(`export (async function|const) ${fn}\\b`));
    expect(load).toContain('from("finance_ledger_v")');
    const vat = read("src/lib/finance/ledger/vat.ts");
    expect(vat).not.toMatch(/server-only|supabase|Date\.now|new Date/);
    expect(read("src/lib/permissions.ts")).toMatch(/accounting: \{[\s\S]*?expenses: CRUD_NO_DEL,/);
    const rt = read("src/lib/realtime-throttle.ts");
    expect(rt).toContain('["/app/giderler", ["cash_entries", "finance_open_items", "finance_parties"]]');
    expect(schema).toContain("array['finance_open_items', 'finance_parties']");
  });
});
