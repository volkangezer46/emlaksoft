import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bodyMd5FromFile, extractFunctionBodies } from "@/lib/migration-rehearsal/core";
import {
  EF_DEFAULT_GRANT_VALID_MONTHS,
  EF_GRANT_KINDS,
  EF_RPC,
  EF_RPC_BURN_EXPIRED,
  EF_WELCOME_VALID_DAYS,
  efIdempotencyKey,
  efPackSchema,
  type EfBalance,
  type EfBurnResult,
  type EfGrantResult,
  type EfSettleResult,
} from "./config";

/**
 * SÖZLEŞME: EmlakFiyati kontör cüzdanı SQL'i (20260826000100..000300) ile src/lib/ef-credits/config.ts RPC sözleşmesi
 * BİREBİR. Saf dosya taraması (DB yok). İşlevsel doğrulama: `npm run db:rehearse -- --yes-i-understand-locks --ef`.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const WALLET = read("supabase/migrations/20260826000100_ef_credit_wallet.sql");
const REPORTS = read("supabase/migrations/20260826000200_ef_reports.sql");
const PACK = read("supabase/migrations/20260826000300_ef_credit_pack_fulfillment.sql");
const SEAT = read("supabase/migrations/20260825000600_seat_purchase_fulfillment.sql");
const EXPIRE = read("supabase/migrations/20260826001200_ef_plan_credit_expiry.sql");
const EXPIRE_RB = read("supabase/rollbacks/20260826001200_ef_plan_credit_expiry.rollback.sql");
const LOTS = read("supabase/migrations/20261010000300_ef_credit_lots_expiry.sql");
const LOTS_RB = read("supabase/rollbacks/20261010000300_ef_credit_lots_expiry.rollback.sql");
const PACK_RB = read("supabase/rollbacks/20260826000300_ef_credit_pack_fulfillment.rollback.sql");

/** `create or replace function public.<name>(<params>)` başlığındaki parametre adları (sıra korunur). */
function paramNames(sql: string, name: string): string[] {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([^)]*)\\)`, "i").exec(sql);
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0]!)
    .filter(Boolean);
}

/** Fonksiyonun tam deyimi (başlık + gövde + kuyruk), sonraki `create or replace function`a kadar. */
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

/** Derleme zamanı tamlık: tipe anahtar eklenirse bu nesneler kırılır. */
const BALANCE_KEYS: Record<keyof EfBalance, true> = { available: true, reserved: true, granted_total: true, committed_total: true, expired_total: true, next_expiry_at: true, next_expiry_units: true };
const SETTLE_KEYS: Record<keyof EfSettleResult, true> = { ok: true, state: true, already: true };
const GRANT_KEYS: Record<keyof EfGrantResult, true> = { ok: true, already: true, available: true };

const stripPackBlocks = (s: string) => s.replace(/^[ \t]*-- credit-pack:v1 >>>[\s\S]*?^[ \t]*-- credit-pack:v1 <<<\n/gm, "");

describe("EF cüzdan RPC'leri = config.ts EF_RPC sözleşmesi", () => {
  it("ad ve parametre adları/sırası birebir", () => {
    expect(paramNames(WALLET, EF_RPC.balance)).toEqual(["p_tenant"]);
    expect(paramNames(WALLET, EF_RPC.reserve)).toEqual(["p_tenant", "p_user", "p_units", "p_idem", "p_item"]);
    expect(paramNames(WALLET, EF_RPC.commit)).toEqual(["p_tenant", "p_reservation", "p_ref"]);
    expect(paramNames(WALLET, EF_RPC.release)).toEqual(["p_tenant", "p_reservation", "p_reason"]);
    expect(paramNames(WALLET, EF_RPC.grant)).toEqual(["p_tenant", "p_units", "p_kind", "p_idem", "p_meta"]);
    expect(paramNames(WALLET, EF_RPC.sweep)).toEqual(["p_older_than"]);
    expect(statementOf(WALLET, EF_RPC.sweep)).toMatch(/p_older_than interval default interval '15 minutes'\)\s*returns integer/);
    expect(paramNames(WALLET, "ef_credit_ready")).toEqual([]);
  });

  it("dönüş JSON anahtarları tiplerle aynı", () => {
    const balance = bodyOf(WALLET, EF_RPC.balance);
    for (const k of Object.keys(BALANCE_KEYS).filter((k) => !["expired_total", "next_expiry_at", "next_expiry_units"].includes(k))) expect(balance, k).toContain(`'${k}'`);
    for (const fn of [EF_RPC.commit, EF_RPC.release]) {
      const b = bodyOf(WALLET, fn);
      for (const k of Object.keys(SETTLE_KEYS)) expect(b, `${fn}.${k}`).toContain(`'${k}'`);
      expect(b).toContain("'unknown'");
    }
    const grant = bodyOf(WALLET, EF_RPC.grant);
    for (const k of Object.keys(GRANT_KEYS)) expect(grant, k).toContain(`'${k}'`);
    const reserve = bodyOf(WALLET, EF_RPC.reserve);
    for (const k of ["ok", "code", "reservation_id", "state", "available", "duplicate", "insufficient", "reserved", "committed"]) {
      expect(reserve, k).toContain(`'${k}'`);
    }
  });

  it("grant türleri EF_GRANT_KINDS ile aynı", () => {
    const grant = bodyOf(WALLET, EF_RPC.grant);
    const kinds = [...grant.matchAll(/when '([a-z_]+)' then '/g)].map((m) => m[1]);
    expect(kinds).toEqual([...EF_GRANT_KINDS]);
  });

  it("her RPC: SECURITY DEFINER, search_path='', service_role kapısı, public/anon/authenticated revoke, yalnız service_role grant", () => {
    const fns = [...Object.values(EF_RPC), "ef_credit_ready"];
    for (const fn of fns) {
      const stmt = statementOf(WALLET, fn);
      expect(stmt, fn).toMatch(/security definer/);
      expect(stmt, fn).toMatch(/set search_path = ''/);
      expect(bodyOf(WALLET, fn), fn).toMatch(/auth\.role\(\) is distinct from 'service_role'/);
      expect(WALLET, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      expect(WALLET, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`));
      expect(WALLET, fn).not.toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to [^;]*authenticated`));
    }
    // ready hata fırlatmaz: claim'siz false, istisnada false.
    const ready = bodyOf(WALLET, "ef_credit_ready");
    expect(ready).toMatch(/is distinct from 'service_role' then\s+return false;/);
    expect(ready).toMatch(/exception when others then\s+return false;/);
    expect(ready).toContain("credit-pack:v1");
  });

  it("atomiklik: yazan her RPC tenant advisory kilidi alır; negatif bakiye yok; süresiz kontör", () => {
    for (const fn of [EF_RPC.reserve, EF_RPC.commit, EF_RPC.release, EF_RPC.grant, EF_RPC.sweep]) {
      expect(bodyOf(WALLET, fn), fn).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' ||");
    }
    expect(bodyOf(WALLET, EF_RPC.reserve)).toMatch(/if v_available < p_units then\s+return jsonb_build_object\('ok', false, 'code', 'insufficient'/);
    expect(WALLET).toMatch(/entry_type = 'grant' and amount > 0 and amount = trunc\(amount\) and expires_at is null/);
    // Grant insert sütunlarında expires_at YOK (süresiz kontör, v1).
    expect(bodyOf(WALLET, EF_RPC.grant)).toContain("(tenant_id, unit, entry_type, amount, source, idempotency_key, feature, meta)");
  });

  it("0 kontörlük işlem: açık rezerv/defter satırı yok, doğrudan kesinleşmiş kayıt", () => {
    const reserve = bodyOf(WALLET, EF_RPC.reserve);
    expect(reserve).toMatch(/if p_units = 0 then[\s\S]*?'committed', 'free', now\(\)[\s\S]*?'state', 'committed'/);
    expect(WALLET).toContain("constraint ef_credit_reservations_free_check check (units > 0 or state = 'committed')");
  });

  it("idempotency anahtarı biçimi: efIdempotencyKey çıktısı SQL deseniyle uyumlu", () => {
    const re = /p_idem !~ '([^']+)'/.exec(bodyOf(WALLET, EF_RPC.reserve))?.[1];
    expect(re).toBe("^[A-Za-z0-9_.:-]{8,128}$");
    const key = efIdempotencyKey("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(new RegExp(re!).test(key)).toBe(true);
    expect(new RegExp(re!).test(`invoice:3f2504e0-4f89-41d3-9a0c-0305e82c3301`)).toBe(true);
  });

  it("defter: 'ef' eklendi, mevcut birimler korundu", () => {
    expect(WALLET).toContain("check (unit in ('try', 'ai', 'valuation', 'ef'))");
    expect(WALLET).toMatch(/check \(source in \('referral', 'partner', 'campaign', 'manual', 'usage', 'plan', 'purchase', 'bonus', 'refund'\)\)/);
  });
});

describe("ef_reports", () => {
  it("kişisel veri sütunu yok; FK adları <tablo>_<kolon>_fkey; tekil rapor; yazma yalnız service_role", () => {
    const cols = /create table if not exists public\.ef_reports \(([\s\S]*?)\n\);/.exec(REPORTS)?.[1] ?? "";
    const names = cols
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[a-z_]+\s+(uuid|text|integer|boolean|timestamptz)\b/.test(l))
      .map((l) => l.split(/\s+/)[0]);
    expect(names).toEqual([
      "id", "tenant_id", "user_id", "rapor_id", "reservation_id", "mahalle_id", "ada", "parsel", "tip",
      "guven_sinifi", "sonuc_durumu", "units_charged", "pdf_charged", "pdf_reservation_id", "created_at", "expires_at",
    ]);
    for (const fk of ["ef_reports_tenant_id_fkey", "ef_reports_user_id_fkey", "ef_reports_reservation_id_fkey", "ef_reports_pdf_reservation_id_fkey"]) {
      expect(REPORTS).toContain(`constraint ${fk} foreign key`);
    }
    expect(REPORTS).toContain("constraint ef_reports_tenant_rapor_key unique (tenant_id, rapor_id)");
    expect(REPORTS).toMatch(/create policy ef_reports_select on public\.ef_reports\s+for select to authenticated/);
    expect(REPORTS).not.toMatch(/create policy[^;]*for (all|insert|update|delete)/);
    expect(REPORTS).toContain("grant select on table public.ef_reports to authenticated;");
  });
});

describe("kontör paketi faturası (20260826000300): taban 20260825000600 bayt bayt korunur", () => {
  it("credit-pack:v1 blokları çıkarılınca gövdeler 20260825000600 ile AYNI (md5)", () => {
    for (const fn of ["fulfill_billing_payment", "fulfill_billing_payment_v2"]) {
      expect(bodyMd5FromFile(stripPackBlocks(PACK), fn), fn).toBe(bodyMd5FromFile(SEAT, fn));
    }
    expect(bodyMd5FromFile(SEAT, "fulfill_billing_payment")).toBe("0f5b4589c3608509d3c7390e08c7834d");
    expect(bodyMd5FromFile(SEAT, "fulfill_billing_payment_v2")).toBe("5fc1c6552b2fe6f963fb72ea3264e03e");
  });

  it("başlıktaki BEKLENEN SONRA md5'leri gövdelerle eşleşir; ön koşul taban md5'lerini arar", () => {
    const f10 = bodyMd5FromFile(PACK, "fulfill_billing_payment")!;
    const v2 = bodyMd5FromFile(PACK, "fulfill_billing_payment_v2")!;
    expect(PACK).toContain(`fulfill_billing_payment (10 arg)  ${f10}`);
    expect(PACK).toContain(`fulfill_billing_payment_v2        ${v2}`);
    expect(PACK).toContain("<> '0f5b4589c3608509d3c7390e08c7834d' then");
    expect(PACK).toContain("<> '5fc1c6552b2fe6f963fb72ea3264e03e' then");
    // Canlı gövde yamalanmaz: yorum satırı dışında pg_get_functiondef kullanımı yok.
    expect(PACK.split("\n").filter((l) => !/^\s*--/.test(l) && /pg_get_functiondef/.test(l))).toEqual([]);
  });

  it("işaretler: credit-pack:v1 eklendi, seat-fulfillment:v1 korundu; bilinmeyen tür reddi yerinde", () => {
    for (const fn of ["fulfill_billing_payment", "fulfill_billing_payment_v2"]) {
      const b = bodyOf(PACK, fn);
      expect(b, fn).toContain("credit-pack:v1");
      expect(b, fn).toContain("seat-fulfillment:v1");
    }
    const f10 = bodyOf(PACK, "fulfill_billing_payment");
    expect(f10).toContain("if v_kind is not null and v_kind <> 'extra_seats' then");
    expect(f10.indexOf("if v_kind = 'credit_pack' then")).toBeLessThan(f10.indexOf("if v_kind is not null and v_kind <> 'extra_seats' then"));
    expect(f10).toContain("'invoice:' || v_invoice_id::text");
    expect(f10).toContain("public.ef_credit_grant(");
    expect(bodyOf(PACK, "fulfill_billing_payment_v2")).toMatch(/if v_result ->> 'kind' = 'credit_pack' then[\s\S]*?checkout_status = 'fulfilled'[\s\S]*?return v_result;/);
  });

  it("paket birim sınırı katalog şemasıyla aynı (1..100000)", () => {
    const base = { id: "paket-1", name: "Paket", priceNetTry: 100, active: true, order: 0 };
    expect(efPackSchema.safeParse({ ...base, units: 100000 }).success).toBe(true);
    expect(efPackSchema.safeParse({ ...base, units: 100001 }).success).toBe(false);
    expect(efPackSchema.safeParse({ ...base, units: 0 }).success).toBe(false);
    expect(bodyOf(PACK, "fulfill_billing_payment")).toContain("or v_pack_units_num < 1 or v_pack_units_num > 100000");
  });

  it("rollback 20260825000600 gövdelerine birebir döner", () => {
    for (const fn of ["fulfill_billing_payment", "fulfill_billing_payment_v2"]) {
      expect(bodyMd5FromFile(PACK_RB, fn), fn).toBe(bodyMd5FromFile(SEAT, fn));
    }
  });
});

/** TARİHSEL dosya: devir tavanı 20261010000300 ile kaldırıldı (RPC no-op); 20260826001200 olduğu gibi kalır (forward-only). */
const EF_RPC_EXPIRE_PLAN = "ef_credit_expire_plan";
const EXPIRE_KEYS = { ok: true, already: true, expired: true, available: true } as const;

describe("TARİHSEL plan kontörü devir tavanı (20260826001200; 20261010000300 no-op yapar)", () => {
  it("ad, parametreler ve dönüş anahtarları birebir", () => {
    expect(paramNames(EXPIRE, EF_RPC_EXPIRE_PLAN)).toEqual(["p_tenant", "p_keep", "p_idem"]);
    const b = bodyOf(EXPIRE, EF_RPC_EXPIRE_PLAN);
    for (const k of Object.keys(EXPIRE_KEYS)) expect(b, k).toContain(`'${k}'`);
  });

  it("service_role-only SECURITY DEFINER, advisory kilit, idempotency, negatif bakiye yok", () => {
    const stmt = statementOf(EXPIRE, EF_RPC_EXPIRE_PLAN);
    expect(stmt).toMatch(/security definer/);
    expect(stmt).toMatch(/set search_path = ''/);
    const b = bodyOf(EXPIRE, EF_RPC_EXPIRE_PLAN);
    expect(b).toMatch(/auth\.role\(\) is distinct from 'service_role'/);
    expect(b).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' ||");
    expect(b).toContain("'ef:expire:' || p_tenant::text || ':' || p_idem");
    expect(b).toMatch(/least\(\s*greatest\(v_available, 0\)/);
    expect(b).toMatch(/\(p_tenant, 'ef', 'spend', -v_excess, 'expire', v_key, 'ef_expire_plan'/);
    expect(EXPIRE).toMatch(/revoke all on function public\.ef_credit_expire_plan\(uuid, integer, text\) from public, anon, authenticated;/);
    expect(EXPIRE).toMatch(/grant execute on function public\.ef_credit_expire_plan\(uuid, integer, text\) to service_role;/);
  });

  it("ef satır CHECK'ine dokunmaz; source CHECK'e yalnız 'expire' eklenir; ön koşul 000100'ü arar; rollback RPC'yi kaldırır", () => {
    expect(EXPIRE).not.toMatch(/alter table[^;]*(add|drop) constraint (if exists )?account_credit_ledger_ef_entry_check/i);
    expect(EXPIRE).toContain("check (source in ('referral', 'partner', 'campaign', 'manual', 'usage', 'plan', 'purchase', 'bonus', 'refund', 'expire'))");
    expect(EXPIRE).toContain("to_regprocedure('public.ef_credit_balance(uuid)') is null");
    expect(EXPIRE).toContain("insert into public.platform_settings (key, value) values ('ef.welcome_units', '10')");
    expect(EXPIRE).toMatch(/'ef\.welcome_since'[\s\S]*on conflict \(key\) do nothing/);
    expect(EXPIRE_RB).toContain("drop function if exists public.ef_credit_expire_plan(uuid, integer, text);");
  });
});
const BURN_KEYS: Record<keyof EfBurnResult, true> = { ok: true, burned_lots: true, burned_units: true, skipped: true };

describe("süreli kontör partileri (20261010000300) = config.ts sözleşmesi", () => {
  it("yanma RPC'si: ad, parametreler, dönüş anahtarları, service_role-only SECURITY DEFINER", () => {
    expect(EF_RPC_BURN_EXPIRED).toBe("ef_credit_burn_expired");
    expect(paramNames(LOTS, EF_RPC_BURN_EXPIRED)).toEqual(["p_limit", "p_grace"]);
    const stmt = statementOf(LOTS, EF_RPC_BURN_EXPIRED);
    expect(stmt).toMatch(/security definer/);
    expect(stmt).toMatch(/set search_path = ''/);
    const b = bodyOf(LOTS, EF_RPC_BURN_EXPIRED);
    for (const k of Object.keys(BURN_KEYS)) expect(b, k).toContain(`'${k}'`);
    expect(b).toMatch(/auth\.role\(\) is distinct from 'service_role'/);
    // Kilit sırası commit ile aynı (tenant kilidi -> parti satırı); idempotent yanma anahtarı.
    expect(b).toContain("pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ef-credit:' || v_row.tenant_id::text, 0))");
    expect(b).toContain("'ef:burn:' || v_lot.id::text");
    expect(b).toContain("'expire'");
    expect(LOTS).toMatch(/revoke all on function public\.ef_credit_burn_expired\(integer, interval\) from public, anon, authenticated;/);
    expect(LOTS).toMatch(/grant execute on function public\.ef_credit_burn_expired\(integer, interval\) to service_role;/);
  });

  it("parametre adları/sırası değişmeyen RPC'lerde (balance, commit, grant) korunur", () => {
    expect(paramNames(LOTS, EF_RPC.balance)).toEqual(paramNames(WALLET, EF_RPC.balance));
    expect(paramNames(LOTS, EF_RPC.commit)).toEqual(paramNames(WALLET, EF_RPC.commit));
    expect(paramNames(LOTS, EF_RPC.grant)).toEqual(paramNames(WALLET, EF_RPC.grant));
    for (const k of ["available", "reserved", "granted_total", "committed_total", "expired_total", "next_expiry_at", "next_expiry_units"]) expect(bodyOf(LOTS, EF_RPC.balance), k).toContain(`'${k}'`);
    const grant = bodyOf(LOTS, EF_RPC.grant);
    for (const k of Object.keys({ ok: 1, already: 1, available: 1 } satisfies Record<keyof EfGrantResult, number>)) expect(grant, k).toContain(`'${k}'`);
  });

  it("süre kuralları TS sabitleriyle aynı: bonus 30 gün, varsayılan 12 ay, aylık hak Istanbul ay sonu, paket faturadaki ay", () => {
    const grant = bodyOf(LOTS, EF_RPC.grant);
    expect(EF_WELCOME_VALID_DAYS).toBe(30);
    expect(EF_DEFAULT_GRANT_VALID_MONTHS).toBe(12);
    expect(grant).toContain(`now() + interval '${EF_WELCOME_VALID_DAYS} days'`);
    expect(grant).toContain(`now() + interval '${EF_DEFAULT_GRANT_VALID_MONTHS} months'`);
    expect(grant).toContain("date_trunc('month', now() at time zone 'Europe/Istanbul') + interval '1 month'");
    expect(grant).toContain("i.meta ->> 'validityMonths'");
    expect(grant).toContain("lots:v1");
    // Defterde ef grant expires_at YAZILMAZ (ef_entry_check ve account_credit_ledger gorunumu degismez); sure lotta.
    expect(grant).not.toMatch(/insert into public\.account_credit_ledger[^;]*expires_at/);
    expect(LOTS).not.toMatch(/alter table public\.account_credit_ledger/i);
  });

  it("harcama FIFO (süresi dolmamış önce, en yakın son kullanma önce); yakma yumuşama payı 1 saat; fulfill DEĞİŞMEZ", () => {
    const commit = bodyOf(LOTS, EF_RPC.commit);
    expect(commit).toContain("order by (o.expires_at <= now()), o.expires_at, o.created_at, o.id");
    expect(commit).toContain("for update");
    expect(LOTS).toContain("p_grace interval default interval '1 hour'");
    expect(LOTS).not.toMatch(/create or replace function public\.fulfill_billing_payment/);
  });

  it("legacy parti: net defter bakiyesi > 0 olan ofis için 12 aylık, idempotent (grant_key tekil)", () => {
    expect(LOTS).toContain("'legacy'");
    expect(LOTS).toContain("now() + interval '12 months', 'ef:legacy:' || t.tenant_id::text");
    expect(LOTS).toContain("on conflict (grant_key) do nothing");
    expect(LOTS).toMatch(/having sum\(l\.amount\) > 0/);
  });

  it("tablo güvenliği: RLS açık, yalnız owner/gm select, anon/authenticated yazma yok, kalan yalnız azalır", () => {
    expect(LOTS).toContain("alter table public.ef_credit_lots enable row level security;");
    expect(LOTS).toMatch(/\(select public\.current_profile_role\(\)\) in \('owner', 'gm'\)/);
    expect(LOTS).toContain("revoke all privileges on table public.ef_credit_lots from public, anon, authenticated;");
    expect(LOTS).toContain("grant select on table public.ef_credit_lots to authenticated;");
    expect(LOTS).toContain("ef_credit_lots: kalan artirilamaz.");
  });

  it("rollback: tabloyu ve yeni RPC'leri kaldırır, balance/commit/grant/expire_plan eski gövdeye döner", () => {
    expect(LOTS_RB).toContain("drop table if exists public.ef_credit_lots;");
    expect(LOTS_RB).toContain("drop function if exists public.ef_credit_burn_expired(integer, interval);");
    expect(LOTS_RB).toContain("drop function if exists public.ef_credit_lots_ready();");
    // Eski gövdeler: 000100 balance/commit/grant ile aynı mantık (sureli parti yok).
    for (const fn of [EF_RPC.balance, EF_RPC.commit, EF_RPC.grant]) {
      const b = bodyOf(LOTS_RB, fn);
      expect(b, fn).not.toContain("ef_credit_lots");
    }
    expect(bodyOf(LOTS_RB, EF_RPC.grant)).toContain("(p_tenant, 'ef', 'grant', p_units, v_source, v_key, 'ef_grant:' || p_kind, p_meta)");
    expect(bodyOf(LOTS_RB, EF_RPC_EXPIRE_PLAN)).toContain("'ef:expire:' || p_tenant::text || ':' || p_idem");
  });
});
