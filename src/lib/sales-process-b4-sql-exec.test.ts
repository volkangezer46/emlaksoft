import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): B4 satış süreci migration'ları.
 *  - 20261019040000 malik karşı teklifi: yalnız service_role, geçerli token + açık teklif, durum DEĞİŞMEZ, bildirim niyeti,
 *    aynı tutar tekrarında replay; kapanmış teklife ve süresi dolmuş bağlantıya izin yok.
 *  - 20261019040002 imza kanıtı kilidi: özet yazıldıktan sonra metin özetle birlikte değişmeden değiştirilemez.
 *  - 20261019040003 stopaj: oran > 0 iken yeni tahakkuk NET yazılır, stopaj ayrı sütunda; oran 0 iken değişmez.
 *  - 20261019040004 defter otomatik kaynağı: aynı anlaşma + taraf için ikinci otomatik satır reddedilir.
 *  - Rollback dosyaları temiz uygulanır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.auth_role', true), '') $$;
create type public.offer_status as enum ('draft', 'submitted', 'countered', 'accepted', 'rejected', 'withdrawn');
create table public.tenants(id uuid primary key default gen_random_uuid(), status text not null default 'active');
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_active boolean not null default true);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text, property_code text,
  assigned_to uuid, deleted_at timestamptz);
create table public.owner_portal_tokens(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  owner_name text not null, token text not null unique, expires_at timestamptz not null default now() + interval '30 days');
create table public.offers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  created_by uuid, amount numeric(14,2) not null, status public.offer_status not null default 'submitted', valid_until date,
  updated_at timestamptz not null default now());
create table public.effects(tenant_id uuid, dedupe_key text, workflow text, user_id uuid, title text, href text);
create function public.enqueue_public_mutation_effect(
  p_tenant_id uuid, p_dedupe_key text, p_workflow text, p_entity_type text, p_entity_id uuid, p_audit_actor_id uuid,
  p_audit_action text, p_audit_old_value jsonb, p_audit_new_value jsonb, p_notification_user_id uuid,
  p_notification_title text, p_notification_body text, p_notification_href text, p_notification_kind text, p_notification_pref_key text
) returns uuid language plpgsql as $$
begin
  insert into public.effects values (p_tenant_id, p_dedupe_key, p_workflow, p_notification_user_id, p_notification_title, p_notification_href);
  return gen_random_uuid();
end $$;
create table public.contracts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text not null, body text not null);
create table public.contract_signers(id uuid primary key default gen_random_uuid(), contract_id uuid not null);
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.rent_charges(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, rental_id uuid not null,
  period date not null, amount numeric(14,2) not null check (amount > 0));
create table public.compliance_ledger_entries(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  kind text not null default 'entry', deal_id uuid, party_role text not null, transaction_type text not null);
`;

describe.skipIf(!mod)("B4 satış süreci migration'ları (pglite)", () => {
  let db: Db;
  let T: string, P: string, ADVISOR: string, OFFER: string, CLOSED: string;
  const TOKEN = "t".repeat(64);
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const asService = () => db.exec(`select set_config('test.auth_role','service_role',false)`);
  const counter = async (offer: string, amount: number, note: string | null = null, token = TOKEN) =>
    (await q(`select public.owner_counter_offer_atomic($1, $2::uuid, $3, $4) as r`, [token, offer, amount, note]))[0]!.r as Record<string, unknown>;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    for (const f of [
      "20261019040000_offer_terms_owner_counter",
      "20261019040002_contract_signature_evidence",
      "20261019040003_rental_withholding_handover",
      "20261019040004_compliance_ledger_auto_source",
    ]) {
      await db.exec(read(`supabase/migrations/${f}.sql`));
    }
    T = String((await q(`insert into public.tenants default values returning id`))[0]!.id);
    ADVISOR = String((await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id);
    P = String((await q(`insert into public.properties(tenant_id, title, assigned_to) values ($1, 'Moda 3+1', $2) returning id`, [T, ADVISOR]))[0]!.id);
    await q(`insert into public.owner_portal_tokens(tenant_id, property_id, owner_name, token) values ($1, $2, 'Malik', $3)`, [T, P, TOKEN]);
    OFFER = String((await q(`insert into public.offers(tenant_id, property_id, amount) values ($1, $2, 5000000) returning id`, [T, P]))[0]!.id);
    CLOSED = String((await q(`insert into public.offers(tenant_id, property_id, amount, status) values ($1, $2, 4000000, 'rejected') returning id`, [T, P]))[0]!.id);
  });

  it("karşı teklif yalnız service_role ile çağrılır", async () => {
    await db.exec(`select set_config('test.auth_role','authenticated',false)`);
    await expect(counter(OFFER, 5_200_000)).rejects.toThrow(/Service role required/);
  });

  it("karşı teklif yazılır, teklif durumu değişmez, danışmana bildirim niyeti düşer; aynı tutar tekrarı replay", async () => {
    await asService();
    expect((await counter(OFFER, 5_200_000, "Kasım sonu tapu")).outcome).toBe("applied");
    const row = (await q(`select status::text as status, owner_counter_amount, owner_counter_note, owner_counter_at from public.offers where id = $1`, [OFFER]))[0]!;
    expect(row.status).toBe("submitted");
    expect(Number(row.owner_counter_amount)).toBe(5_200_000);
    expect(row.owner_counter_note).toBe("Kasım sonu tapu");
    expect(row.owner_counter_at).not.toBeNull();
    const effects = await q(`select workflow, user_id, href from public.effects`);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ workflow: "owner_offer_counter", user_id: ADVISOR, href: `/app/teklifler/${OFFER}` });
    expect((await counter(OFFER, 5_200_000, "Kasım sonu tapu")).outcome).toBe("replay");
    expect(await q(`select 1 from public.effects`)).toHaveLength(1);
  });

  it("kapanmış teklif, geçersiz bağlantı ve geçersiz tutar reddedilir", async () => {
    await asService();
    expect((await counter(CLOSED, 4_100_000)).outcome).toBe("already_finalized");
    expect((await counter(OFFER, 5_100_000, null, "x".repeat(64))).outcome).toBe("invalid_link");
    expect((await counter(OFFER, 0)).outcome).toBe("invalid_input");
    expect((await counter(OFFER, 1.234)).outcome).toBe("invalid_input");
  });

  it("imza kanıtı kilidi: özet yazıldıktan sonra metin değiştirilemez; doğrulama kodu sabittir", async () => {
    const C = String((await q(`insert into public.contracts(tenant_id, title, body) values ($1, 'Kapora', 'Metin') returning id`, [T]))[0]!.id);
    await q(`update public.contracts set body = 'Taslakta serbest' where id = $1`, [C]);
    await q(`update public.contracts set body_sha256 = $2, verify_code = 'ABCDEFGHJKMN' where id = $1`, [C, "a".repeat(64)]);
    await expect(q(`update public.contracts set body = 'Değişti' where id = $1`, [C])).rejects.toThrow(/degistirilemez/);
    await expect(q(`update public.contracts set verify_code = 'ABCDEFGHJKMP' where id = $1`, [C])).rejects.toThrow(/Dogrulama kodu/);
    await expect(q(`update public.contracts set verify_code = 'abc' where id = $1`, [C])).rejects.toThrow();
  });

  it("stopaj: oran > 0 iken tahakkuk NET + stopaj ayrı; oran 0 iken brüt kalır; elle verilen stopaja dokunulmaz", async () => {
    const R0 = String((await q(`insert into public.rentals(tenant_id) values ($1) returning id`, [T]))[0]!.id);
    const R20 = String((await q(`insert into public.rentals(tenant_id, usage, withholding_rate) values ($1, 'isyeri', 20) returning id`, [T]))[0]!.id);
    await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1, $2, '2026-11-01', 25000)`, [T, R0]);
    await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount) values ($1, $2, '2026-11-01', 25000)`, [T, R20]);
    await q(`insert into public.rent_charges(tenant_id, rental_id, period, amount, withholding_amount) values ($1, $2, '2026-12-01', 20000, 5000)`, [T, R20]);
    const rows = await q(`select rental_id, period::text as period, amount, withholding_amount from public.rent_charges order by rental_id = $1, period`, [R20]);
    const plain = rows.find((r) => r.rental_id === R0)!;
    expect([Number(plain.amount), Number(plain.withholding_amount)]).toEqual([25000, 0]);
    const net = rows.filter((r) => r.rental_id === R20).map((r) => [Number(r.amount), Number(r.withholding_amount)]);
    expect(net).toEqual([[20000, 5000], [20000, 5000]]);
    await expect(q(`update public.rentals set withholding_rate = 60 where id = $1`, [R20])).rejects.toThrow();
    await expect(q(`update public.rentals set usage = 'depo' where id = $1`, [R20])).rejects.toThrow();
  });

  it("defter: aynı anlaşma + taraf için ikinci otomatik satır reddedilir; elle satır serbest", async () => {
    const D = "00000000-0000-4000-8000-0000000000d1";
    await q(`insert into public.compliance_ledger_entries(tenant_id, deal_id, party_role, transaction_type, source) values ($1, $2, 'buyer', 'sale', 'auto')`, [T, D]);
    await expect(
      q(`insert into public.compliance_ledger_entries(tenant_id, deal_id, party_role, transaction_type, source) values ($1, $2, 'buyer', 'sale', 'auto')`, [T, D]),
    ).rejects.toThrow();
    await q(`insert into public.compliance_ledger_entries(tenant_id, deal_id, party_role, transaction_type) values ($1, $2, 'buyer', 'sale')`, [T, D]);
    await expect(q(`insert into public.compliance_ledger_entries(tenant_id, party_role, transaction_type, source) values ($1, 'buyer', 'sale', 'robot')`, [T])).rejects.toThrow();
  });

  it("rollback dosyaları temiz uygulanır", async () => {
    for (const f of [
      "20261019040004_compliance_ledger_auto_source",
      "20261019040003_rental_withholding_handover",
      "20261019040002_contract_signature_evidence",
      "20261019040000_offer_terms_owner_counter",
    ]) {
      await db.exec(read(`supabase/rollbacks/${f}.rollback.sql`));
    }
    const cols = await q(
      `select column_name from information_schema.columns where table_schema = 'public' and column_name in ('owner_counter_amount','withholding_amount','body_sha256','source')`,
    );
    expect(cols).toEqual([]);
  });
});
