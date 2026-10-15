import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { portalPresence } from "@/lib/listing-control/kpi";

/**
 * İŞLEVSEL SQL TESTİ (pglite): SK9 migration'ları —
 *  20261016090000 properties.currency (+ features.currency backfill, döviz kayıtlarında türetilmiş price_health temizliği),
 *  20261016090100 yayın kapısı DB kopyası (transition_property_status_atomic), aktif satılık stok sayımı
 *  (portfolio_counts) ve portalda varlık tek tanımı (property_portal_presence). Şema sadeleştirilmiş taklittir.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text, phone text, unique (id, tenant_id));
create table public.properties(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_code text, transaction_type text, status text,
  list_price numeric, price_health text, features jsonb not null default '{}', is_sample boolean not null default false,
  province_id uuid, district_id uuid, authorization_type text, authorization_start date, authorization_end date,
  assigned_to uuid, deleted_at timestamptz, published_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), unique (id, tenant_id));
create table public.property_owner_info(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null unique, customer_id uuid,
  relation text, deed_status text, listing_source text, kvkk_consent boolean not null default false);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text, new_value jsonb);
`;

describe.skipIf(!mod)("SK9 migration'ları (pglite)", () => {
  let db: Db;
  let T: string;
  let VILLA: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const asService = () => db.exec(`select set_config('request.jwt.claim.role','service_role',false)`);
  const transition = async (ids: string[], status: string) =>
    (await q(`select public.transition_property_status_atomic($1, gen_random_uuid(), $2::uuid[], $3, 'test') as r`, [T, ids, status]))[0]!
      .r as { outcome: string; blocked_ids?: string[]; updated_count?: number };
  const prop = async (over: Record<string, unknown>) => {
    const cols = Object.keys(over);
    const vals = Object.values(over);
    const sql = `insert into public.properties(tenant_id, ${cols.join(", ")}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")}) returning id`;
    return (await q(sql, [T, ...vals]))[0]!.id as string;
  };
  const completeOwner = async (propertyId: string, phone: string | null = "05321234567") => {
    const c = (await q(`insert into public.customers(tenant_id, full_name, phone) values ($1, 'Malik', $2) returning id`, [T, phone]))[0]!.id;
    await q(
      `insert into public.property_owner_info(tenant_id, property_id, customer_id, relation, deed_status, listing_source, kvkk_consent)
       values ($1, $2, $3, 'malik', 'kat_mulkiyeti', 'Saha / tabela', true)`,
      [T, propertyId, c],
    );
  };
  const GEO = { province_id: "00000000-0000-0000-0000-0000000000a1", district_id: "00000000-0000-0000-0000-0000000000b1" };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    // Migration ÖNCESİ: features.currency=USD villa (ham dolarla hesaplanmış sahte "red"), TL ve boş para birimli kayıtlar.
    VILLA = await prop({ property_code: "VILLA", transaction_type: "Satılık", status: "draft", list_price: 850000, price_health: "red", features: { currency: "USD" } });
    await prop({ property_code: "TL", transaction_type: "Satılık", status: "live", list_price: 1000, price_health: "green", features: { currency: "TL" } });
    await db.exec(read("supabase/migrations/20261016090000_property_currency.sql"));
    await db.exec(read("supabase/migrations/20261016090100_publish_gate_portfolio_counts.sql"));
  });

  it("currency kolonu features.currency'den doldurulur; döviz kaydının türetilmiş sağlığı temizlenir, TL kayda dokunulmaz", async () => {
    const rows = await q(`select property_code, currency, price_health from public.properties order by property_code`);
    expect(rows).toEqual([
      { property_code: "TL", currency: "TRY", price_health: "green" },
      { property_code: "VILLA", currency: "USD", price_health: null },
    ]);
    await expect(q(`update public.properties set currency = 'GBP' where id = $1`, [VILLA])).rejects.toThrow();
  });

  it("migration'lar yeniden koşulabilir (idempotent)", async () => {
    await db.exec(read("supabase/migrations/20261016090000_property_currency.sql"));
    await db.exec(read("supabase/migrations/20261016090100_publish_gate_portfolio_counts.sql"));
    expect((await q(`select currency from public.properties where id = $1`, [VILLA]))[0]!.currency).toBe("USD");
  });

  it("aktif satılık stok = Satılık ∧ (live, reserved) ∧ örnek değil ∧ ₺; dövizli ayrı, kira toplamı ayrı", async () => {
    await prop({ property_code: "RES", transaction_type: "Satılık", status: "reserved", list_price: 500 });
    await prop({ property_code: "SOLD", transaction_type: "Satılık", status: "sold", list_price: 99999 });
    await prop({ property_code: "DRAFT", transaction_type: "Satılık", status: "draft", list_price: 77777 });
    await prop({ property_code: "SAMPLE", transaction_type: "Satılık", status: "live", list_price: 5555, is_sample: true });
    await prop({ property_code: "RENT", transaction_type: "Kiralık", status: "live", list_price: 25000 });
    await prop({ property_code: "USDLIVE", transaction_type: "Satılık", status: "live", list_price: 300000, features: { currency: "USD" } });
    await q(`update public.properties set currency = 'USD' where property_code = 'USDLIVE'`);
    await db.exec(`select set_config('request.jwt.claim.sub', gen_random_uuid()::text, false), set_config('test.tenant', '${T}', false)`);
    const r = (await q(`select public.portfolio_counts() as c`))[0]!.c as Record<string, unknown>;
    // Kabul SQL'iyle birebir (₺ kayıtlar): sum(list_price) where Satılık ∧ status in (live, reserved) ∧ is_sample=false.
    const expected = (await q(
      `select sum(list_price)::numeric as s from public.properties where tenant_id=$1 and transaction_type='Satılık'
         and status in ('live','reserved') and deleted_at is null and is_sample=false and currency='TRY'`,
      [T],
    ))[0]!.s;
    expect(Number(r.sale_stock_value)).toBe(Number(expected));
    expect(Number(r.sale_stock_value)).toBe(1500);
    expect(r.sale_stock_fx).toEqual({ USD: 300000, EUR: 0 });
    expect(Number(r.rent_monthly_total)).toBe(25000);
    expect(r.total).toBeTypeOf("number");
  });

  it("yayın kapısı: il/ilçe ya da tamamlanmış sahip kaydı yoksa 'live' yapılamaz; hiçbir satır değişmez", async () => {
    await asService();
    const noGeo = await prop({ property_code: "NOGEO", transaction_type: "Satılık", status: "draft", list_price: 1 });
    await completeOwner(noGeo);
    const noOwner = await prop({ property_code: "NOOWNER", transaction_type: "Satılık", status: "draft", list_price: 1, ...GEO, authorization_type: "open" });
    const noPhone = await prop({ property_code: "NOPHONE", transaction_type: "Satılık", status: "draft", list_price: 1, ...GEO, authorization_type: "open" });
    await completeOwner(noPhone, null);
    const badDates = await prop({ property_code: "DATES", transaction_type: "Satılık", status: "draft", list_price: 1, ...GEO, authorization_type: "exclusive" });
    await completeOwner(badDates);
    const ok = await prop({ property_code: "OK", transaction_type: "Satılık", status: "draft", list_price: 1, ...GEO, authorization_type: "open" });
    await completeOwner(ok);

    const r = await transition([noGeo, noOwner, noPhone, badDates, ok], "live");
    expect(r.outcome).toBe("publish_blocked");
    expect(new Set(r.blocked_ids)).toEqual(new Set([noGeo, noOwner, noPhone, badDates]));
    const statuses = await q(`select status from public.properties where id = any($1::uuid[])`, [[noGeo, noOwner, noPhone, badDates, ok]]);
    expect(statuses.every((s) => s.status === "draft")).toBe(true);

    const single = await transition([ok], "live");
    expect(single).toMatchObject({ outcome: "applied", updated_count: 1 });
    // Zaten live olan kayıt engellenmez (replay); başka duruma geçiş kapıdan etkilenmez.
    expect((await transition([ok], "live")).outcome).toBe("replay");
    expect((await transition([noOwner], "reserved")).outcome).toBe("applied");
  });

  it("service_role dışı çağrı reddedilir (kapı admin istemcisi yolunda da geçerli)", async () => {
    await db.exec(`select set_config('request.jwt.claim.role','authenticated',false)`);
    await expect(transition([VILLA], "live")).rejects.toThrow(/Service role required/);
    await asService();
  });

  it("property_portal_presence SQL tanımı TS kopyasıyla aynı", async () => {
    const cases: [string | null, string | null][] = [
      ["live", "verified"], ["live", "probable_missing"], ["live", "unchecked"], ["live", null], ["removed", "verified"], [null, null], ["LIVE", "verified"],
    ];
    for (const [reg, state] of cases) {
      const sql = (await q(`select public.property_portal_presence($1, $2) as p`, [reg, state]))[0]!.p;
      expect(sql, `${reg}/${state}`).toBe(portalPresence(reg, state));
    }
  });

  it("geri alma (090100 → 090000): eski sayım ve kapısız RPC döner, kolon kalkar", async () => {
    await db.exec(read("supabase/rollbacks/20261016090100_publish_gate_portfolio_counts.rollback.sql"));
    await db.exec(read("supabase/rollbacks/20261016090000_property_currency.rollback.sql"));
    const r = (await q(`select public.portfolio_counts() as c`))[0]!.c as Record<string, unknown>;
    expect(r.sale_stock_value).toBeUndefined();
    expect((await q(`select to_regprocedure('public.property_portal_presence(text,text)') as f`))[0]!.f).toBeNull();
    expect(await q(`select 1 from information_schema.columns where table_name='properties' and column_name='currency'`)).toEqual([]);
    const loose = await prop({ property_code: "LOOSE", transaction_type: "Satılık", status: "draft", list_price: 1 });
    expect((await transition([loose], "live")).outcome).toBe("applied");
  });
});
