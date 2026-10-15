import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { commissionCashAmount } from "./collection-link";

/**
 * İŞLEVSEL SQL TESTİ (pglite; SK6/B180 + B109): "tahsil edildi" işaretleme ↔ kasa hareketi idempotentliği.
 * markCommissionsPaidBulk'ın sorgusu birebir (id ∈ seçim, tenant_id = ofis, status ∉ (paid, collected) → paid, RETURNING) ve
 * ardından finance_record_entry (20261012001400 tavan + mükerrer) KDV dahil tutarla koşar:
 *  - paid/collected bir komisyon ikinci kez işaretlenemez (RETURNING boş) → kasaya ikinci hareket yazılmaz;
 *  - zorla tekrar yazım denense bile RPC hesaptan bağımsız `duplicate` döner; kasada tek hareket kalır;
 *  - kasaya yazılan tutar gross + KDV'dir ve RPC tavanı (gross + vat) onu kabul eder.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.expenses(id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, category text default 'diger', title text,
  amount numeric default 0, currency text default 'TRY', expense_date date, notes text, receipt_url text);
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  gross_amount numeric not null default 0, vat_amount numeric not null default 0, status text default 'calculated');
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, amount numeric not null default 0, voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, amount numeric not null default 0, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant update on public.commissions to authenticated;
`;

describe.skipIf(!mod)("komisyon tahsilatı ↔ kasa idempotentliği (pglite)", () => {
  let db: Db;
  let T: string, T2: string, ME: string, ACC: string, ACC2: string, C1: string, C2: string, X1: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','expenses:view expenses:create expenses:edit commissions:edit',false), set_config('test.role','owner',false)`);
    await db.exec(`set role authenticated`);
  };
  /** markCommissionsPaidBulk: aynı süzgeçlerle güncelle, dönen her satır için KDV dahil kasa hareketi. */
  const markPaid = async (ids: string[], accountId: string) => {
    const rows = await q(
      `update public.commissions set status = 'paid'
        where id = any($1::uuid[]) and tenant_id = $2 and not (status in ('paid', 'collected'))
        returning id, gross_amount, vat_amount`,
      [ids, T],
    );
    const outcomes: string[] = [];
    for (const r of rows) {
      const res = (
        await q(`select public.finance_record_entry($1::uuid, 'in', $2::numeric, '2026-10-05'::date, 'komisyon', 'Komisyon tahsilatı', null, null, null, 'commission', $3::uuid) as r`, [
          accountId,
          commissionCashAmount({ gross_amount: r.gross_amount, vat_amount: r.vat_amount }),
          r.id,
        ])
      )[0]!.r as { outcome: string };
      outcomes.push(res.outcome);
    }
    return { updated: rows.length, outcomes };
  };
  const entries = async (id: string) => {
    await db.exec(`reset role`);
    const rows = await q(`select amount from public.cash_entries where source_type = 'commission' and source_id = $1 and voided_at is null`, [id]);
    await as(ME);
    return rows.map((r) => Number(r.amount));
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ME = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001100_finance_salary_privacy_void_audit.sql"));
    await db.exec(read("supabase/migrations/20261012001400_finance_entry_source_amount_guard.sql"));
    await as(ME);
    const acc = async (name: string) =>
      ((await q(`select public.finance_account_create('office','bank',$1,null,'TRY',0::numeric,'2026-10-01'::date) as r`, [name]))[0]!.r as { account_id: string })
        .account_id;
    ACC = await acc("Banka");
    ACC2 = await acc("Kasa");
    await db.exec(`reset role`);
    C1 = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 192000, 38400) returning id`, [T]))[0]!.id as string;
    C2 = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount, status) values ($1, 5000, 1000, 'collected') returning id`, [T]))[0]!
      .id as string;
    X1 = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 7000, 0) returning id`, [T2]))[0]!.id as string;
    await as(ME);
  });

  it("ilk işaretleme: yalnız bekleyen ve bu ofisin kaydı paid olur; kasaya KDV dahil (230.400) yazılır", async () => {
    const res = await markPaid([C1, C2, X1], ACC);
    expect(res).toEqual({ updated: 1, outcomes: ["recorded"] });
    expect(await entries(C1)).toEqual([230400]);
    expect(await entries(C2)).toEqual([]);
    expect(await entries(X1)).toEqual([]);
    await db.exec(`reset role`);
    expect((await q(`select status from public.commissions where id = $1`, [X1]))[0]!.status).toBe("calculated");
    await as(ME);
  });

  it("ikinci işaretleme hiçbir satır döndürmez; kasada tek hareket kalır", async () => {
    expect(await markPaid([C1], ACC)).toEqual({ updated: 0, outcomes: [] });
    expect(await markPaid([C1], ACC2)).toEqual({ updated: 0, outcomes: [] });
    expect(await entries(C1)).toEqual([230400]);
  });

  it("zorla yeniden yazım (Kasaya işle / yeniden dene) başka hesaba da duplicate döner", async () => {
    const r = (
      await q(`select public.finance_record_entry($1::uuid, 'in', 230400::numeric, '2026-10-05'::date, 'komisyon', 'Komisyon tahsilatı', null, null, null, 'commission', $2::uuid) as r`, [
        ACC2,
        C1,
      ])
    )[0]!.r as { outcome: string };
    expect(r.outcome).toBe("duplicate");
    expect(await entries(C1)).toEqual([230400]);
  });

  it("KDV dahil tutar tavanı aşmaz; bir kuruş fazlası reddedilir", async () => {
    await db.exec(`reset role`);
    const c = (await q(`insert into public.commissions(tenant_id, gross_amount, vat_amount) values ($1, 1000, 200) returning id`, [T]))[0]!.id as string;
    await as(ME);
    const over = (
      await q(`select public.finance_record_entry($1::uuid, 'in', 1200.01::numeric, '2026-10-05'::date, 'komisyon', 'x', null, null, null, 'commission', $2::uuid) as r`, [ACC, c])
    )[0]!.r as { reason?: string };
    expect(over.reason).toBe("amount_exceeds_source");
    expect(await markPaid([c], ACC)).toEqual({ updated: 1, outcomes: ["recorded"] });
    expect(await entries(c)).toEqual([1200]);
  });
});
