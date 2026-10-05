import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractFunctionBodies } from "@/lib/migration-rehearsal/core";
import {
  TRY_GRANT_KINDS,
  TRY_IDEM_PATTERN,
  TRY_MAX_SHARE_SETTING_KEY,
  TRY_MOVEMENTS_VIEW,
  TRY_RPC,
  tryBalanceSchema,
  tryGrantResultSchema,
  tryInvoiceHoldSchema,
  tryOverviewSchema,
  tryRefundResultSchema,
  tryReserveResultSchema,
  tryReverseResultSchema,
  trySettleResultSchema,
} from "./config";

/**
 * SÖZLEŞME: TL hesap kredisi SQL'i (20260826000400 + 000500) ile src/lib/try-credits/config.ts BİREBİR.
 * Saf dosya taraması (DB yok). İşlevsel doğrulama: try-wallet-sql-exec.test.ts (pglite varsa) ve
 * `npm run db:rehearse` benzeri sahip provası.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const WALLET = read("supabase/migrations/20260826000400_try_credit_wallet.sql");
const INVOICE = read("supabase/migrations/20260826000500_try_credit_invoice_payment.sql");
const ALL = `${WALLET}\n${INVOICE}`;

function paramNames(sql: string, name: string): string[] {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([^)]*)\\)`, "i").exec(sql);
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0]!)
    .filter(Boolean);
}

function statementOf(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i"));
  if (start < 0) return "";
  const next = sql.slice(start + 10).search(/create\s+or\s+replace\s+function\s+public\./i);
  return next < 0 ? sql.slice(start) : sql.slice(start, start + 10 + next);
}

function bodyOf(sql: string, name: string): string {
  const all = extractFunctionBodies(sql).filter((b) => b.name === name);
  expect(all, name).toHaveLength(1);
  return all[0]!.body;
}

const walletFns = [TRY_RPC.balance, TRY_RPC.grant, TRY_RPC.reserve, TRY_RPC.commit, TRY_RPC.release, TRY_RPC.reverse];
const invoiceFns = [
  TRY_RPC.invoiceHold,
  TRY_RPC.fulfillInvoice,
  TRY_RPC.releaseInvoice,
  TRY_RPC.releaseDead,
  TRY_RPC.refundInvoice,
];

describe("TL kredi RPC'leri = config.ts TRY_RPC sözleşmesi", () => {
  it("ad ve parametre adları/sırası birebir", () => {
    expect(paramNames(WALLET, TRY_RPC.balance)).toEqual(["p_tenant"]);
    expect(paramNames(WALLET, TRY_RPC.grant)).toEqual(["p_tenant", "p_amount", "p_kind", "p_idem", "p_expires_at", "p_meta"]);
    expect(paramNames(WALLET, TRY_RPC.reserve)).toEqual(["p_tenant", "p_user", "p_amount", "p_idem", "p_invoice", "p_max_share"]);
    expect(paramNames(WALLET, TRY_RPC.commit)).toEqual(["p_tenant", "p_reservation", "p_ref"]);
    expect(paramNames(WALLET, TRY_RPC.release)).toEqual(["p_tenant", "p_reservation", "p_reason"]);
    expect(paramNames(WALLET, TRY_RPC.reverse)).toEqual(["p_tenant", "p_amount", "p_reason", "p_idem", "p_original_idem", "p_meta"]);
    expect(paramNames(WALLET, TRY_RPC.myOverview)).toEqual([]);
    expect(paramNames(WALLET, TRY_RPC.ready)).toEqual([]);
    expect(paramNames(INVOICE, TRY_RPC.invoiceHold)).toEqual(["p_tenant", "p_conversation_id"]);
    expect(paramNames(INVOICE, TRY_RPC.fulfillInvoice)).toEqual([
      "p_conversation_id",
      "p_expected_tenant_id",
      "p_payment_id",
      "p_source",
      "p_expected_plan",
      "p_expected_cycle",
      "p_cash_try",
    ]);
    expect(paramNames(INVOICE, TRY_RPC.releaseInvoice)).toEqual(["p_tenant", "p_invoice", "p_reason"]);
    expect(paramNames(INVOICE, TRY_RPC.releaseDead)).toEqual(["p_limit"]);
    expect(paramNames(INVOICE, TRY_RPC.refundInvoice)).toEqual(["p_tenant", "p_invoice", "p_amount", "p_idem", "p_reason"]);
    expect(paramNames(INVOICE, TRY_RPC.ready)).toEqual([]);
  });

  it("TS tarafı çağrı argüman adları SQL parametreleriyle aynı (wallet.ts + fulfillment.ts)", () => {
    const wallet = read("src/lib/try-credits/wallet.ts");
    const fulfillment = read("src/lib/billing/fulfillment.ts");
    for (const p of ["p_tenant", "p_amount", "p_kind", "p_idem", "p_expires_at", "p_meta", "p_user", "p_invoice", "p_max_share", "p_reservation", "p_ref", "p_reason", "p_original_idem", "p_conversation_id", "p_limit"]) {
      expect(wallet, p).toContain(p);
    }
    for (const p of paramNames(INVOICE, TRY_RPC.fulfillInvoice)) expect(fulfillment, p).toContain(p);
  });

  it("dönüş JSON anahtarları TS şemalarıyla aynı", () => {
    const balance = bodyOf(WALLET, "try_credit_calc_balance");
    for (const k of Object.keys(tryBalanceSchema.shape)) expect(balance, k).toContain(`'${k}'`);
    const overview = bodyOf(WALLET, TRY_RPC.myOverview);
    expect(overview).toContain("'open_reservations'");
    for (const k of Object.keys(tryOverviewSchema.shape).filter((k) => !(k in tryBalanceSchema.shape))) expect(overview, k).toContain(`'${k}'`);
    for (const k of ["reservation_id", "invoice_id", "amount", "created_at"]) expect(overview, k).toContain(`'${k}'`);

    const grant = bodyOf(WALLET, TRY_RPC.grant);
    for (const k of Object.keys(tryGrantResultSchema.shape)) expect(grant, k).toContain(`'${k}'`);

    const reserve = bodyOf(WALLET, TRY_RPC.reserve);
    for (const code of ["ok", "duplicate", "insufficient", "over_cap", "invoice_not_found", "invoice_not_payable", "invoice_already_reserved"]) {
      expect(reserve, code).toContain(`'${code}'`);
    }
    for (const k of ["ok", "code", "reservation_id", "state", "amount", "available", "max_amount"]) expect(reserve, k).toContain(`'${k}'`);
    // şema birleşimi her kodu kabul eder
    expect(tryReserveResultSchema.safeParse({ ok: false, code: "over_cap", max_amount: 1 }).success).toBe(true);

    for (const fn of [TRY_RPC.commit, TRY_RPC.release, TRY_RPC.releaseInvoice]) {
      const b = bodyOf(fn === TRY_RPC.releaseInvoice ? INVOICE : WALLET, fn);
      if (fn === TRY_RPC.releaseInvoice) continue; // yalnız try_credit_release sonucunu iletir
      for (const k of Object.keys(trySettleResultSchema.shape).filter((k) => k !== "code")) expect(b, `${fn}.${k}`).toContain(`'${k}'`);
      expect(b).toContain("'unknown'");
    }
    expect(bodyOf(WALLET, TRY_RPC.commit)).toContain("'code', 'insufficient'");

    const reverse = bodyOf(WALLET, TRY_RPC.reverse);
    for (const k of ["ok", "already", "balance", "available", "debt", "code", "remaining", "original_not_found", "exceeds_original"]) expect(reverse, k).toContain(`'${k}'`);
    expect(tryReverseResultSchema.safeParse({ ok: false, code: "exceeds_original", remaining: 1 }).success).toBe(true);

    const hold = bodyOf(INVOICE, TRY_RPC.invoiceHold);
    for (const k of ["has_hold", "reservation_id", "invoice_id", "state", "amount", "total_try", "cash_try"]) expect(hold, k).toContain(`'${k}'`);
    expect(tryInvoiceHoldSchema.safeParse({ has_hold: false }).success).toBe(true);

    const refund = bodyOf(INVOICE, TRY_RPC.refundInvoice);
    for (const k of ["ok", "already", "restored", "remaining", "available", "balance", "no_credit_used", "exceeds_credit_used"]) expect(refund, k).toContain(`'${k}'`);
    expect(tryRefundResultSchema.safeParse({ ok: false, code: "no_credit_used" }).success).toBe(true);
  });

  it("grant türleri TRY_GRANT_KINDS ile aynı", () => {
    const kinds = [...bodyOf(WALLET, TRY_RPC.grant).matchAll(/when '([a-z_]+)' then '/g)].map((m) => m[1]);
    expect(kinds).toEqual([...TRY_GRANT_KINDS]);
  });

  it("idempotency anahtarı biçimi SQL ile TS'te aynı", () => {
    for (const fn of [TRY_RPC.grant, TRY_RPC.reserve, TRY_RPC.reverse]) {
      expect(/p_idem !~ '([^']+)'/.exec(bodyOf(WALLET, fn))?.[1], fn).toBe(TRY_IDEM_PATTERN.source);
    }
    expect(/p_idem !~ '([^']+)'/.exec(bodyOf(INVOICE, TRY_RPC.refundInvoice))?.[1]).toBe(TRY_IDEM_PATTERN.source);
  });
});

describe("güvenlik: her yazan RPC service_role-only", () => {
  it("SECURITY DEFINER, search_path='', service_role kapısı, public/anon/authenticated revoke, yalnız service_role grant", () => {
    const cases: Array<[string, string]> = [
      ...walletFns.map((f): [string, string] => [WALLET, f]),
      ...invoiceFns.map((f): [string, string] => [INVOICE, f]),
    ];
    for (const [sql, fn] of cases) {
      const stmt = statementOf(sql, fn);
      expect(stmt, fn).toMatch(/security definer/);
      expect(stmt, fn).toMatch(/set search_path = ''/);
      expect(bodyOf(sql, fn), fn).toMatch(/auth\.role\(\) is distinct from 'service_role'/);
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
      expect(sql, fn).not.toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to [^;]*authenticated`));
    }
  });

  it("ic yardımcılar HİÇ kimseye (service_role dahil) açık değil", () => {
    for (const fn of ["try_credit_calc_state", "try_credit_calc_balance"]) {
      expect(WALLET).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, service_role;`));
      expect(WALLET).not.toMatch(new RegExp(`grant execute on function public\\.${fn}`));
    }
  });

  it("ofis okuması: yalnız authenticated, kendi tenant'ı, yazma yok", () => {
    const stmt = statementOf(WALLET, TRY_RPC.myOverview);
    expect(stmt).toMatch(/security definer/);
    expect(stmt).toMatch(/\bstable\b/);
    const body = bodyOf(WALLET, TRY_RPC.myOverview);
    expect(body).toContain("(select public.current_tenant_id())");
    expect(body).toMatch(/auth\.role\(\) is distinct from 'authenticated' or v_tenant is null/);
    expect(body).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/i);
    expect(WALLET).toMatch(/revoke all on function public\.try_credit_my_overview\(\) from public, anon;/);
    expect(WALLET).toMatch(/grant execute on function public\.try_credit_my_overview\(\) to authenticated;/);
  });

  it("ready: claim'siz/istisnada false (hata fırlatmaz)", () => {
    for (const [sql, label] of [[WALLET, "000400"], [INVOICE, "000500"]] as const) {
      const ready = bodyOf(sql, TRY_RPC.ready);
      expect(ready, label).toMatch(/is distinct from 'service_role' then\s+return false;/);
      expect(ready, label).toMatch(/exception when others then\s+return false;/);
    }
    // nihai surum fatura odeme fonksiyonlarini ve fulfill/v2'yi de yoklar
    const final = bodyOf(INVOICE, TRY_RPC.ready);
    for (const fn of invoiceFns) expect(final, fn).toContain(`public.${fn}(`);
    expect(final).toContain("public.fulfill_billing_payment_v2(");
  });

  it("tablo: RLS açık, authenticated yalnız select, yazma yalnız service_role; silme/gecis korumasi", () => {
    expect(WALLET).toContain("alter table public.try_credit_reservations enable row level security;");
    expect(WALLET).toContain("revoke all privileges on table public.try_credit_reservations from public, anon, authenticated;");
    expect(WALLET).toContain("grant select on table public.try_credit_reservations to authenticated;");
    expect(WALLET).toContain("grant all privileges on table public.try_credit_reservations to service_role;");
    expect(WALLET).toMatch(/tenant_id = \(select public\.current_tenant_id\(\)\)/);
    expect(WALLET).toContain("kayit silinemez");
    expect(WALLET).toContain("sonuclanmis rezervin durumu degisemez");
    // fatura basina tek canli rezerv
    expect(WALLET).toMatch(/create unique index if not exists uq_try_credit_reservations_invoice_live[\s\S]*?where invoice_id is not null and state in \('reserved', 'committed'\)/);
    // hareket gorunumu: invoker + hassas sutun yok
    expect(WALLET).toContain(`create or replace view public.${TRY_MOVEMENTS_VIEW} with (security_invoker = true)`);
    const view = /create or replace view public\.try_credit_movements[\s\S]*?;/.exec(WALLET)![0];
    expect(view).not.toContain("idempotency_key");
    expect(view).not.toMatch(/\bmeta\b/);
  });
});

describe("para güvenliği: atomiklik, negatif bakiye, çift harcama", () => {
  it("yazan her RPC tenant advisory kilidi alır (aynı anahtar)", () => {
    for (const fn of [TRY_RPC.grant, TRY_RPC.reserve, TRY_RPC.commit, TRY_RPC.release, TRY_RPC.reverse]) {
      expect(bodyOf(WALLET, fn), fn).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' ||");
    }
    for (const fn of [TRY_RPC.fulfillInvoice, TRY_RPC.refundInvoice]) {
      expect(bodyOf(INVOICE, fn), fn).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' ||");
    }
    expect(bodyOf(INVOICE, TRY_RPC.releaseDead)).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('try-credit:' ||");
  });

  it("rezerv: harcanabilir bakiye kontrolü + fatura payı + tek canlı rezerv; bakiye lock altında okunur", () => {
    const b = bodyOf(WALLET, TRY_RPC.reserve);
    expect(b.indexOf("pg_advisory_xact_lock")).toBeLessThan(b.indexOf("try_credit_calc_balance"));
    expect(b).toMatch(/if v_available < p_amount then\s+return jsonb_build_object\('ok', false, 'code', 'insufficient'/);
    expect(b).toContain("v_max := floor(v_inv_total * p_max_share * 100) / 100;");
    expect(b).toMatch(/if p_amount > v_max then\s+return jsonb_build_object\('ok', false, 'code', 'over_cap'/);
    expect(b).toContain("p_max_share <= 0 or p_max_share > 1");
    expect(b).toContain("'invoice_already_reserved'");
    expect(b).toContain("for update;"); // fatura satırı kilidi
  });

  it("commit: harcanabilirlik commit ANINDA yeniden doğrulanır; spend satırı rezerv kimliğiyle tekil; tek yönlü", () => {
    const b = bodyOf(WALLET, TRY_RPC.commit);
    expect(b).toMatch(/if v_spendable < v_row\.amount then\s+return jsonb_build_object\('ok', false, 'state', 'reserved'/);
    expect(b).toContain("'try:spend:' || v_row.id::text");
    expect(b).toMatch(/-v_row\.amount/);
    expect(b).toContain("where r.tenant_id = p_tenant and r.id = p_reservation\n  for update;");
    expect(b).toMatch(/if v_row\.state = 'committed' then[\s\S]*?'already', true/);
    expect(b).toMatch(/if v_row\.state = 'released' then\s+return jsonb_build_object\('ok', false/);
  });

  it("clawback bakiye kontrolü YAPMAZ ama orijinal grant tutarını aşamaz; negatif reverse satırı", () => {
    const b = bodyOf(WALLET, TRY_RPC.reverse);
    expect(b).not.toContain("insufficient");
    expect(b).toContain("-p_amount");
    expect(b).toMatch(/if v_already_reversed \+ p_amount > v_orig_amount then/);
    expect(b).toContain("'reversesKey'");
  });

  it("defter: try satır biçimi CHECK'i yalnız unit='try' için; mevcut birimlere dokunmaz", () => {
    expect(WALLET).toMatch(/check \(\s*unit <> 'try'\s+or \(entry_type = 'grant' and amount > 0/);
    expect(WALLET).not.toMatch(/drop constraint if exists account_credit_ledger_unit_check/);
    expect(WALLET).not.toMatch(/drop constraint if exists account_credit_ledger_source_check/);
    // Ön koşul: ef cüzdanının kaynak CHECK genişlemesi (refund/bonus) şart
    expect(WALLET).toContain("account_credit_ledger_source_check refund/bonus icermiyor");
    // created_at = clock_timestamp(): id sırası = zaman sırası
    expect(WALLET.match(/clock_timestamp\(\)/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("tekrar oynatma: eksi bakiye borç olarak izlenir; vade FIFO; available eksiye inmez", () => {
    const state = bodyOf(WALLET, "try_credit_calc_state");
    expect(state).toContain("v_debt := v_debt + v_need;");
    expect(state).toMatch(/if v_debt > 0 then/);
    expect(state).toMatch(/v_exps\[v_i\] is null or v_exps\[v_i\] > r\.created_at/);
    const bal = bodyOf(WALLET, "try_credit_calc_balance");
    expect(bal).toContain("greatest(v_live - v_debt - v_reserved, 0)");
  });
});

describe("kredi ile fatura ödemesi: fulfill gövdelerine DOKUNULMAZ", () => {
  it("000500 fulfill_billing_payment/v2'yi YENİDEN TANIMLAMAZ (md5 ön koşulu bozulmaz), yalnız çağırır", () => {
    expect(INVOICE).not.toMatch(/create\s+or\s+replace\s+function\s+public\.fulfill_billing_payment/i);
    expect(WALLET).not.toMatch(/fulfill_billing_payment/);
    const b = bodyOf(INVOICE, TRY_RPC.fulfillInvoice);
    expect(b).toContain("public.fulfill_billing_payment_v2(");
  });

  it("fatura toplamı fulfill'e TAM gönderilir (tutar/KDV doğrulaması aynen çalışır); nakit + kredi = toplam", () => {
    const b = bodyOf(INVOICE, TRY_RPC.fulfillInvoice);
    expect(b).toMatch(/abs\(v_total - \(v_cash \+ v_res\.amount\)\) > 0\.01/);
    expect(b).toMatch(/v_total,\s+'TRY'\s+\);/);
    // tutar/KDV sütunlarına dokunulmaz
    const updates = [...b.matchAll(/update public\.invoices i\s+set([\s\S]*?)where/g)].map((m) => m[1]!);
    for (const u of updates) expect(u).not.toMatch(/amount_try|tax_try|total_try/);
  });

  it("nakit yoksa demo/capture'sız yol, nakit varsa iyzico + provider ödeme kimliği zorunlu", () => {
    const b = bodyOf(INVOICE, TRY_RPC.fulfillInvoice);
    expect(b).toContain("if v_payment_id is null or v_source not in ('callback', 'webhook') then");
    expect(b).toContain("v_provider := 'iyzico';");
    expect(b).toContain("v_provider := 'demo';");
    expect(b).toContain("Full-credit payment must not carry a provider payment id.");
    expect(b).toContain("'paidWith'");
  });

  it("kredi kesinleştirme + fulfill tek transaction: kesinleştirme fulfill'den ÖNCE, ayrı exception bloğu yok", () => {
    const b = bodyOf(INVOICE, TRY_RPC.fulfillInvoice);
    expect(b.indexOf("public.try_credit_commit(")).toBeLessThan(b.indexOf("public.fulfill_billing_payment_v2("));
    expect(b).not.toMatch(/exception\s+when/i);
    expect(b).toContain("Wallet credit reservation is not active.");
    expect(b).toContain("Wallet credit and cash do not add up to the invoice total.");
  });

  it("iade: harcanan krediyi aşamaz, idempotent, pozitif reverse + refundOfReservation", () => {
    const b = bodyOf(INVOICE, TRY_RPC.refundInvoice);
    expect(b).toContain("'try:refund:' ||");
    expect(b).toMatch(/if v_amount > v_remaining then\s+return jsonb_build_object\('ok', false, 'code', 'exceeds_credit_used'/);
    expect(b).toContain("'refundOfReservation'");
    expect(b).toContain("r.state = 'committed'");
  });

  it("sahipsiz rezerv: yalnız void/expired faturalar serbest bırakılır; committed asla", () => {
    const b = bodyOf(INVOICE, TRY_RPC.releaseDead);
    expect(b).toContain("i.status = 'void'");
    expect(b).toContain("'expired', 'initialization_failed'");
    expect(b).toMatch(/where r\.id = v_row\.id and r\.state = 'reserved'/);
  });
});

describe("kayıt yerleri", () => {
  it("rollback dosyaları var ve ters sırada anlatılmış", () => {
    const files = readdirSync(resolve(process.cwd(), "supabase/rollbacks"));
    expect(files).toContain("20260826000400_try_credit_wallet.rollback.sql");
    expect(files).toContain("20260826000500_try_credit_invoice_payment.rollback.sql");
    expect(read("supabase/rollbacks/20260826000500_try_credit_invoice_payment.rollback.sql")).toContain("Sira: bu dosya -> 20260826000400 rollback");
  });

  it("migration öncesi/sonrası: ön koşul DO bloğu ilk deyimlerde, lock_timeout var", () => {
    for (const sql of [WALLET, INVOICE]) {
      expect(sql).toContain("set local lock_timeout = '5s';");
      expect(sql.indexOf("do $$")).toBeLessThan(sql.indexOf("create or replace function"));
    }
    expect(ALL).not.toMatch(/\bdrop table\b/i);
  });

  it("ayar anahtarı sabit", () => {
    expect(TRY_MAX_SHARE_SETTING_KEY).toBe("try_credit.max_invoice_share");
  });
});
