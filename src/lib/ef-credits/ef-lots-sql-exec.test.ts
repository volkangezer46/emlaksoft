import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ: SÜRELİ KONTÖR (20261010000300) gerçek PL/pgSQL ile (pglite, bellek içi Postgres).
 * Sıra: cüzdan (20260826000100) -> devir tavanı (20260826001200) -> [eski bakiye tohumla] -> 20261010000300.
 * Şema canlının SADELEŞTİRİLMİŞ taklididir (tenants/profiles/invoices/ledger/auth.role()). `@electric-sql/pglite`
 * devDependency'dir; yüklenemezse ATLANIR. Tek bağlantı olduğundan eşzamanlılık burada denenmez (advisory lock sözleşme testinde).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.tenant', true),'')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.prole', true),''),'owner') $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id));
create table public.invoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), status text not null default 'draft', meta jsonb not null default '{}', created_at timestamptz default now());
create table public.platform_settings(key text primary key, value text, updated_at timestamptz default now());
create table public.account_credit_ledger (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit text not null, entry_type text not null, amount numeric(14,2) not null check (amount <> 0), source text not null, source_id uuid,
  idempotency_key text not null unique, available_at timestamptz not null default now(), expires_at timestamptz, created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), feature text, model text, tokens_in int, tokens_out int);
alter table public.account_credit_ledger add constraint account_credit_ledger_unit_check check (unit in ('try','ai','valuation'));
alter table public.account_credit_ledger add constraint account_credit_ledger_source_check check (source in ('referral','partner','campaign','manual','usage'));
alter table public.account_credit_ledger enable row level security;
create function public.account_credit_ledger_immutable() returns trigger language plpgsql as $$ begin raise exception 'append-only' using errcode='42501'; end $$;
create trigger trg_imm before update or delete on public.account_credit_ledger for each row execute function public.account_credit_ledger_immutable();
create function public.fulfill_billing_payment(p_provider text,p_conversation_id text,p_payment_id text,p_source text,p_target_type text,p_expected_tenant_id uuid,p_expected_plan text,p_expected_cycle text,p_expected_amount_try numeric,p_expected_currency text) returns jsonb language sql as $$ select '{}'::jsonb /* credit-pack:v1 */ $$;
`;

describe.skipIf(!mod)("Süreli kontör SQL (20261010000300) — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  let LEGACY: string;
  let seq = 0;

  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  type Res = { ok?: boolean; already?: boolean; available?: number; err?: string; code?: string; [k: string]: unknown };
  const call = async (sql: string, params?: unknown[]): Promise<Res> => {
    try {
      const row = (await q(sql, params))[0];
      return (row ? Object.values(row)[0] : undefined) as Res;
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { err: err.message, code: err.code };
    }
  };
  const newTenant = async () => ((await q(`insert into public.tenants default values returning id`))[0]!.id as string);
  const grant = (t: string, units: number, kind: string, idem: string, meta: Record<string, unknown> | null = null) =>
    call(`select public.ef_credit_grant($1,$2,$3,$4,$5::jsonb)`, [t, units, kind, idem, meta ? JSON.stringify(meta) : null]);
  const balance = (t: string) => call(`select public.ef_credit_balance($1)`, [t]);
  const spend = async (t: string, units: number) => {
    seq += 1;
    const r = await call(`select public.ef_credit_reserve($1,null,$2,$3,'valuation_konut')`, [t, units, `spend-test-${seq}-xxxx`]);
    if (!r.ok) return r;
    return call(`select public.ef_credit_commit($1,$2::uuid,null)`, [t, r.reservation_id as string]);
  };
  const lots = (t: string) => q(`select kind, units, remaining, expires_at, burned_at from public.ef_credit_lots where tenant_id = $1 order by expires_at, created_at`, [t]);
  const ledgerSum = async (t: string) => Number((await q(`select coalesce(sum(amount),0) s from public.account_credit_ledger where unit='ef' and tenant_id=$1`, [t]))[0]!.s);
  const lotSum = async (t: string) => Number((await q(`select coalesce(sum(remaining),0) s from public.ef_credit_lots where tenant_id=$1`, [t]))[0]!.s);
  const minutesFromNow = async (iso: unknown) => (new Date(iso as string | Date).getTime() - Date.now()) / 60_000;
  const asService = () => db.exec(`select set_config('request.jwt.claim.role','service_role',false)`);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260826000100_ef_credit_wallet.sql"));
    await db.exec(read("supabase/migrations/20260826001200_ef_plan_credit_expiry.sql"));
    await asService();
    // ESKİ (süresiz) bakiye: 120 yüklendi, 20 harcandı -> net 100.
    LEGACY = await newTenant();
    await grant(LEGACY, 120, "plan_monthly", "plan-legacy-0001");
    await spend(LEGACY, 20);
    await db.exec(read("supabase/migrations/20261010000300_ef_credit_lots_expiry.sql"));
  }, 90_000);

  it("eski bakiye TEK SEFERLİK 12 aylık 'legacy' partiye döner; parti toplamı = defter toplamı", async () => {
    const rows = await lots(LEGACY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "legacy", units: 100, remaining: 100 });
    const days = (await minutesFromNow(rows[0]!.expires_at)) / 1440;
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(367);
    expect(await balance(LEGACY)).toMatchObject({ available: 100, granted_total: 120, committed_total: 20, expired_total: 0 });
    expect(await lotSum(LEGACY)).toBe(await ledgerSum(LEGACY));
  });

  it("aylık plan hakkı İstanbul ay sonunda yanar; bonus 30 gün; paket faturadaki ay kadar; varsayılan 12 ay", async () => {
    const t = await newTenant();
    const plan = await grant(t, 40, "plan_monthly", "plan-test-0001");
    expect(plan).toMatchObject({ ok: true, already: false });
    const expected = (
      await q(`select (date_trunc('month', now() at time zone 'Europe/Istanbul') + interval '1 month') at time zone 'Europe/Istanbul' as e`)
    )[0]!.e;
    expect(new Date((await lots(t))[0]!.expires_at as Date).getTime()).toBe(new Date(expected as Date).getTime());

    const bonus = await grant(t, 10, "bonus", "welcome-test-0001");
    expect(bonus.ok).toBe(true);
    const inv = (await q(`insert into public.invoices(tenant_id, meta) values ($1, '{"validityMonths":3}') returning id`, [t]))[0]!.id as string;
    expect((await grant(t, 3000, "purchase", `invoice:${inv}`, { invoiceId: inv, packId: "ef-1000-3a" })).ok).toBe(true);
    const adminDefault = await grant(t, 5, "admin", "admin-test-0001");
    expect(adminDefault.ok).toBe(true);
    const adminSix = await grant(t, 5, "admin", "admin-test-0002", { validityMonths: 6 });
    expect(adminSix.ok).toBe(true);

    const byKind = new Map<string, number[]>();
    for (const r of await lots(t)) {
      const days = (await minutesFromNow(r.expires_at)) / 1440;
      byKind.set(String(r.kind), [...(byKind.get(String(r.kind)) ?? []), days]);
    }
    expect(byKind.get("bonus")![0]).toBeGreaterThan(29.9);
    expect(byKind.get("bonus")![0]).toBeLessThan(30.1);
    expect(byKind.get("purchase")![0]).toBeGreaterThan(88);
    expect(byKind.get("purchase")![0]).toBeLessThan(93);
    const admins = byKind.get("admin")!.sort((a, b) => a - b);
    expect(admins[0]).toBeGreaterThan(180); // 6 ay
    expect(admins[0]).toBeLessThan(186);
    expect(admins[1]).toBeGreaterThan(364); // varsayılan 12 ay
    expect(admins[1]).toBeLessThan(367);
    expect(await lotSum(t)).toBe(await ledgerSum(t));
  });

  it("geçersiz süre reddedilir; aynı anahtar tekrar = already (ikinci parti yok)", async () => {
    const t = await newTenant();
    expect((await grant(t, 10, "admin", "admin-bad-0001", { validityMonths: 0 })).code).toBe("22023");
    expect((await grant(t, 10, "admin", "admin-bad-0002", { validityMonths: 25 })).code).toBe("22023");
    expect((await grant(t, 10, "admin", "admin-bad-0003", { validityMonths: "abc" })).code).toBe("22023");
    expect(await grant(t, 10, "admin", "admin-ok-00001", { validityMonths: 3 })).toMatchObject({ ok: true, already: false });
    expect(await grant(t, 10, "admin", "admin-ok-00001", { validityMonths: 3 })).toMatchObject({ ok: true, already: true });
    expect(await lots(t)).toHaveLength(1);
  });

  it("harcama FIFO: önce en yakın tarihte sona erecek parti azalır; defter spend satırı lot dağılımını taşır", async () => {
    const t = await newTenant();
    await grant(t, 100, "admin", "fifo-long-0001", { validityMonths: 12 });
    await grant(t, 50, "bonus", "fifo-short-0001"); // 30 gün
    expect(await balance(t)).toMatchObject({ available: 150 });
    expect(await spend(t, 60)).toMatchObject({ ok: true, state: "committed" });
    const rows = await lots(t);
    // 30 günlük bonus (50) bitti, 12 aylık admin partisinden 10 düştü.
    expect(rows.map((r) => [r.kind, Number(r.remaining)])).toEqual([
      ["bonus", 0],
      ["admin", 90],
    ]);
    const spendRow = (await q(`select amount, meta from public.account_credit_ledger where tenant_id=$1 and entry_type='spend'`, [t]))[0]!;
    expect(Number(spendRow.amount)).toBe(-60);
    expect((spendRow.meta as { lots: unknown[] }).lots).toHaveLength(2);
    expect(await balance(t)).toMatchObject({ available: 90, committed_total: 60 });
    expect(await lotSum(t)).toBe(await ledgerSum(t));
  });

  it("süresi dolan parti 'available'a girmez; yetersiz bakiye reddedilir; yakma defterde 'expire' satırı + kalan 0, idempotent", async () => {
    const t = await newTenant();
    await grant(t, 100, "admin", "burn-live-0001", { validityMonths: 12 });
    // Süresi geçmiş parti (test: doğrudan ekleme; üretimde zaman geçerek oluşur).
    await db.exec(`
      insert into public.account_credit_ledger (tenant_id, unit, entry_type, amount, source, idempotency_key, feature)
        values ('${t}', 'ef', 'grant', 80, 'plan', 'ef:grant:${t}:old-plan-0001', 'ef_grant:plan_monthly');
      insert into public.ef_credit_lots (tenant_id, kind, units, remaining, expires_at, grant_key)
        values ('${t}', 'plan_monthly', 80, 80, now() - interval '2 days', 'ef:grant:${t}:old-plan-0001');
    `);
    // Eski parti kullanılabilir DEĞİL.
    expect(await balance(t)).toMatchObject({ available: 100, granted_total: 180 });
    expect((await spend(t, 150)) as Res).toMatchObject({ ok: false, code: "insufficient", available: 100 });

    const burned = await call(`select public.ef_credit_burn_expired()`);
    expect(burned).toMatchObject({ ok: true, burned_lots: 1, burned_units: 80 });
    const again = await call(`select public.ef_credit_burn_expired()`);
    expect(again).toMatchObject({ ok: true, burned_lots: 0, burned_units: 0 });

    const row = (await q(`select amount, source, feature from public.account_credit_ledger where tenant_id=$1 and source='expire'`, [t]))[0]!;
    expect(Number(row.amount)).toBe(-80);
    expect(row.feature).toBe("ef_expire_lot");
    expect(await balance(t)).toMatchObject({ available: 100, granted_total: 180, committed_total: 0, expired_total: 80 });
    expect(await lotSum(t)).toBe(await ledgerSum(t));
  });

  it("yakma yumuşama payı: yeni dolan parti 1 saat beklemeden yakılmaz; payı 0 verilirse yakılır", async () => {
    const t = await newTenant();
    await db.exec(`
      insert into public.account_credit_ledger (tenant_id, unit, entry_type, amount, source, idempotency_key, feature)
        values ('${t}', 'ef', 'grant', 7, 'plan', 'ef:grant:${t}:fresh-0001', 'ef_grant:plan_monthly');
      insert into public.ef_credit_lots (tenant_id, kind, units, remaining, expires_at, grant_key)
        values ('${t}', 'plan_monthly', 7, 7, now() - interval '5 minutes', 'ef:grant:${t}:fresh-0001');
    `);
    const keep = (await call(`select public.ef_credit_burn_expired(2000)`)) as Res;
    expect(keep.ok).toBe(true);
    expect((await lots(t))[0]).toMatchObject({ remaining: 7 });
    expect(await call(`select public.ef_credit_burn_expired(2000, interval '0 minutes')`)).toMatchObject({ ok: true });
    expect((await lots(t))[0]).toMatchObject({ remaining: 0 });
  });

  it("parti kalanı artırılamaz; devir tavanı RPC'si no-op; hazır bayrağı doğru", async () => {
    const t = await newTenant();
    await grant(t, 10, "admin", "guard-test-0001", { validityMonths: 1 });
    let failed = false;
    try {
      await db.exec(`update public.ef_credit_lots set remaining = remaining + 1 where tenant_id='${t}'`);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(await call(`select public.ef_credit_expire_plan($1, 0, 'plan-expire:2026-10')`, [t])).toMatchObject({ ok: true, expired: 0, available: 10 });
    expect(await call(`select public.ef_credit_lots_ready()`)).toBe(true);
    await db.exec(`select set_config('request.jwt.claim.role','anon',false)`);
    expect(await call(`select public.ef_credit_lots_ready()`)).toBe(false);
    await asService();
  });

  it("ücretsiz (0 kontörlük) akış ve rezerv iadesi parti bakiyesini değiştirmez", async () => {
    const t = await newTenant();
    await grant(t, 30, "admin", "free-test-00001", { validityMonths: 3 });
    const free = await call(`select public.ef_credit_reserve($1,null,0,'free-flow-0001','valuation_konut')`, [t]);
    expect(free).toMatchObject({ ok: true, state: "committed" });
    const r = await call(`select public.ef_credit_reserve($1,null,10,'rel-flow-00001','valuation_konut')`, [t]);
    expect(r).toMatchObject({ ok: true, state: "reserved", available: 20 });
    await call(`select public.ef_credit_release($1,$2::uuid,'test')`, [t, r.reservation_id as string]);
    expect(await balance(t)).toMatchObject({ available: 30, reserved: 0 });
    expect((await lots(t))[0]).toMatchObject({ remaining: 30 });
  });
});
