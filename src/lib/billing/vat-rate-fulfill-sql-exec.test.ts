import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { invoiceAmountsTry } from "@/lib/billing/invoice-amounts";

/**
 * GP2 İŞLEVSEL SQL TESTİ: 20261014012000 (otomatik faturada geçerlilik tarihli KDV) gerçek PL/pgSQL ile (pglite).
 * Fulfill gövdeleri 20261007001010'dan OLDUĞU GİBİ yüklenir, ardından migration dosyası TAMAMEN çalıştırılır (canlı gövde
 * üzerinden `pg_get_functiondef` dönüşümü dahil). Şema canlının sadeleştirilmiş taklididir (plan-change-sql-exec ile aynı).
 * Kanıtlanan: oran değişince yeni (meta.vatRate yazılı) fatura kendi oranıyla doğrulanır; eski (oranı yazılmamış) fatura
 * %20 ile doğrulanmaya devam eder; yanlış oranla gelen tahsilat reddedilir; dönüşüm idempotenttir.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.tenant', true),'')::uuid $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), plan text not null default 'office', status text not null default 'active', updated_at timestamptz);
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), role text not null default 'advisor', is_active boolean not null default true);
create table public.subscriptions(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null unique references public.tenants(id),
  plan text not null, status text not null default 'active', billing_cycle text not null default 'monthly',
  amount_try numeric, price_lock_try numeric, price_lock_campaign text, trial_ends_at timestamptz, cancelled_at timestamptz,
  iyzico_subscription_ref text, current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean not null default false, updated_at timestamptz);
create table public.audit_logs(id bigserial primary key, tenant_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, old_value jsonb, new_value jsonb);
create table public.platform_settings(key text primary key, value text);
create table public.invoices(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), subscription_id uuid,
  status text not null default 'draft', checkout_status text, amount_try numeric, tax_try numeric, total_try numeric, currency text default 'TRY',
  period_start timestamptz, period_end timestamptz, due_at timestamptz, paid_at timestamptz, iyzico_payment_id text,
  meta jsonb not null default '{}', created_at timestamptz not null default now());
create table public.billing_fulfillment_events(
  id uuid primary key default gen_random_uuid(), provider text not null, conversation_id text not null, payment_id text,
  source text, target_type text, status text, tenant_id uuid, invoice_id uuid, payment_link_id uuid, result jsonb, completed_at timestamptz,
  unique (provider, conversation_id), unique (provider, payment_id));
create function public.plan_monthly_amount(p text) returns numeric language sql immutable as $$
  select case p when 'advisor' then 749 when 'office' then 2490 when 'professional' then 4990 when 'business' then 8990 when 'enterprise' then 12900 end $$;
create function public.plan_catalog_document() returns jsonb language sql stable as $$
  select nullif(value,'')::jsonb from public.platform_settings where key = 'billing.plan_definitions' $$;
create table public.plan_entitlements(plan text primary key, seat_limit int, customer_limit int, active_property_limit int, branch_limit int);
insert into public.plan_entitlements values ('advisor',1,null,null,null),('office',10,null,null,null),('professional',20,null,null,null),('business',40,null,null,null),('enterprise',50,null,null,null);
create function public.plan_period_amount(p text, c text) returns numeric language sql immutable as $$
  select public.plan_monthly_amount(p) * case when c = 'yearly' then 10 else 1 end $$;
create function public.plan_campaign_lock_amount(p text) returns numeric language sql immutable as $$ select null::numeric $$;
`;

function upgradeFunctionsSql(): string {
  const sql = read("supabase/migrations/20261007001010_plan_upgrade_fulfillment.sql");
  return sql.slice(sql.indexOf("create or replace function public.fulfill_billing_payment("));
}

/** growth_cash_net (20260826000600 gövdesi, aynen): migration bunu da faturanın oranına çevirir. */
const GROWTH_CASH_NET = `
create or replace function public.growth_cash_net(p_invoice uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(case
           when jsonb_typeof(i.meta -> 'walletCashTry') = 'number' and (i.meta ->> 'walletCashTry')::numeric > 0
             then least((i.meta ->> 'walletCashTry')::numeric / 1.2, i.amount_try)
           else i.amount_try end, 2)
  from public.invoices i where i.id = p_invoice;
$$;`;

describe.skipIf(!mod)("GP2: fulfill faturanın kendi KDV oranıyla doğrular (20261014012000, pglite)", () => {
  let db: Db;
  let seq = 0;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  type Res = Record<string, unknown> & { err?: string; code?: string };
  const call = async (sql: string, params?: unknown[]): Promise<Res> => {
    try {
      const row = (await q(sql, params))[0];
      return (row ? Object.values(row)[0] : undefined) as Res;
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { err: err.message, code: err.code };
    }
  };
  const asService = () => db.exec(`select set_config('request.jwt.claim.role','service_role',false)`);

  async function office() {
    const t = (await q(`insert into public.tenants(plan) values ('office') returning id`))[0]!.id as string;
    await q(`insert into public.profiles(tenant_id, role) values ($1,'owner')`, [t]);
    const sub = (
      await q(
        `insert into public.subscriptions(tenant_id, plan, status, billing_cycle, amount_try, current_period_start, current_period_end)
         values ($1,'office','active','monthly',2490, now() - interval '15 days', now() + interval '15 days') returning id`,
        [t],
      )
    )[0]!.id as string;
    return { t, sub };
  }

  /** TS'nin kestiği gibi fatura: tutarlar `invoiceAmountsTry(net, oran)`; oran verilirse meta.vatRate'e yazılır. */
  async function invoice(o: { t: string; sub: string }, net: number, rate: number | null, meta: Record<string, unknown> = {}) {
    seq += 1;
    const conv = `es-vat-${seq}`;
    const a = invoiceAmountsTry(net, rate ?? undefined);
    const row = (
      await q(
        `insert into public.invoices(tenant_id, subscription_id, status, checkout_status, amount_try, tax_try, total_try, meta)
         values ($1,$2,'draft','pending_checkout',$3,$4,$5,$6) returning id`,
        [o.t, o.sub, a.amountTry, a.taxTry, a.totalTry, JSON.stringify({ conversationId: conv, plan: "office", cycle: "monthly", ...(rate === null ? {} : { vatRate: rate }), ...meta })],
      )
    )[0]!;
    return { conv, id: row.id as string, ...a };
  }
  const fulfill = (o: { t: string }, conv: string, total: number) =>
    call(`select public.fulfill_billing_payment_v2('demo',$1,null,'demo','subscription',$2,'office','monthly',$3,'TRY')`, [conv, o.t, total]);
  const inv = async (id: string) => (await q(`select * from public.invoices where id = $1`, [id]))[0]!;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261007001000_subscription_pause_and_plan_change.sql"));
    await db.exec(upgradeFunctionsSql());
    await db.exec(GROWTH_CASH_NET);
    await db.exec(read("supabase/migrations/20261014012000_billing_vat_rate_invoices.sql"));
  }, 90_000);

  it("dönüşüm: sabit %20 ifadesi kalmaz; ikinci çalıştırma idempotent; yoklama true", async () => {
    await asService();
    const src = (await q(`select prosrc from pg_proc where proname = 'fulfill_billing_payment' and pronargs = 10`))[0]!.prosrc as string;
    expect(src).not.toContain("v_amount_try * 0.20");
    expect(src.match(/public\.billing_invoice_vat_rate\(v_invoice_meta\)/g)).toHaveLength(4);
    await db.exec(read("supabase/migrations/20261014012000_billing_vat_rate_invoices.sql"));
    expect(await call(`select public.billing_vat_rate_ready()`)).toBe(true);
    expect(Number(await call(`select public.billing_invoice_vat_rate('{}'::jsonb)`))).toBe(0.2);
    expect(Number(await call(`select public.billing_invoice_vat_rate('{"vatRate":0.18}'::jsonb)`))).toBe(0.18);
    expect(Number(await call(`select public.billing_invoice_vat_rate('{"vatRate":"0.18"}'::jsonb)`))).toBe(0.2);
    expect(Number(await call(`select public.billing_invoice_vat_rate('{"vatRate":1.5}'::jsonb)`))).toBe(0.2);
  });

  it("KDV ayarı %18'e inince yeni fatura %18 ile doğrulanır ve tamamlanır; KDV satırı değişmez", async () => {
    await asService();
    const o = await office();
    const i = await invoice(o, 2490, 0.18);
    expect(i.totalTry).toBe(2938.2);
    expect(await fulfill(o, i.conv, i.totalTry)).toMatchObject({ ok: true, plan: "office" });
    const row = await inv(i.id);
    expect(row.status).toBe("paid");
    expect(Number(row.tax_try)).toBe(448.2);
    expect(Number(row.total_try)).toBe(2938.2);
  });

  it("eski fatura (oranı yazılmamış, %20 ile kesilmiş) oran değişiminden sonra da %20 ile doğrulanır", async () => {
    await asService();
    const o = await office();
    const old = await invoice(o, 2490, null);
    expect(old.totalTry).toBe(2988);
    expect(await fulfill(o, old.conv, old.totalTry)).toMatchObject({ ok: true });
    expect(Number((await inv(old.id)).tax_try)).toBe(498);
  });

  it("faturadaki orandan farklı tutarla gelen tahsilat reddedilir (22023)", async () => {
    await asService();
    const o = await office();
    const i = await invoice(o, 2490, 0.18);
    const wrong = invoiceAmountsTry(2490).totalTry; // %20 ile hesaplanmış toplam
    expect(await fulfill(o, i.conv, wrong)).toMatchObject({ code: "22023" });
    expect((await inv(i.id)).status).toBe("draft");
  });

  it("ek kullanıcı ve analiz paketi dalları da faturanın oranını kullanır (tutar uyuşmazlığı hatası yok)", async () => {
    await asService();
    const o = await office();
    const seat = await invoice(o, 300, 0.1, { kind: "extra_seats" });
    const res = await fulfill(o, seat.conv, seat.totalTry);
    expect(res.err ?? "").not.toMatch(/Invoice total does not match/);
    const pack = await invoice(o, 1000, 0.1, { kind: "credit_pack", packId: "p1", units: 1000, priceNetTry: 1000 });
    const res2 = await fulfill(o, pack.conv, pack.totalTry);
    expect(res2.err ?? "").not.toMatch(/Invoice total does not match/);
  });

  it("growth_cash_net: kredili faturada nakit brüt → net faturanın oranıyla", async () => {
    await asService();
    const o = await office();
    const i = await invoice(o, 1000, 0.1, { walletCashTry: 550 });
    expect(Number(await call(`select public.growth_cash_net($1)`, [i.id]))).toBe(500);
    const legacy = await invoice(o, 1000, null, { walletCashTry: 600 });
    expect(Number(await call(`select public.growth_cash_net($1)`, [legacy.id]))).toBe(500);
  });
});
