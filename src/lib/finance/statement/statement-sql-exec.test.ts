import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261011001200_bank_statement_import — taslak yazma (mükerrer dosya/satır), onay (hareket üret,
 * mevcutla eşle, atla), mutabakat işareti ve durum sayacı, kişisel hesap gizliliği, maaş kapısı, tahsilat bağı yetkisi,
 * doğrudan yazma yok, taslağı at, rollback.
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
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.rent_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.building_payments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, voided_at timestamptz);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb);
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
`;

const H = (n: number) => `h${String(n).padStart(8, "0")}`;
const line = (n: number, d: string, dir: "in" | "out", amt: number, desc: string) => ({ d, dir, amt, desc, h: H(n), bal: null });
const FILE = (c: string) => c.repeat(64);

describe.skipIf(!mod)("bank statement import (pglite)", () => {
  let db: Db;
  let T: string, OWNER: string, ADV: string, ADV2: string;
  let BANK: string, PERSONAL: string, RENT: string;
  let imp1: string;
  const lineIds: Record<string, string> = {};
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false)`);
    await db.exec(`set role authenticated`);
  };
  const FULL = "expenses:view expenses:create expenses:edit expenses:delete commissions:edit rentals:edit";
  const NOCOLLECT = "expenses:view expenses:create expenses:edit";
  const rpc = async (sql: string, params: unknown[]) => (await q(`select ${sql} as r`, params))[0]!.r as Record<string, unknown>;
  const stage = (acc: string, hash: string, lines: unknown[], format = "csv") =>
    rpc(`public.finance_statement_stage($1::uuid, $2, $3, $4::jsonb)`, [acc, hash, format, JSON.stringify(lines)]);
  const apply = (acc: string, decisions: unknown[]) => rpc(`public.finance_statement_apply($1::uuid, $2::jsonb)`, [acc, JSON.stringify(decisions)]);
  const lineId = async (hash: string) => (await q(`select id from public.finance_statement_lines where line_hash = $1`, [hash]))[0]!.id as string;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    ADV2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    RENT = (await q(`insert into public.rent_payments(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000600_finance_accounts_cash_entries.sql"));
    await db.exec(read("supabase/migrations/20261011001200_bank_statement_import.sql"));
    await as(OWNER, FULL, "owner");
    BANK = (await rpc(`public.finance_account_create('office','bank','İş Bankası Örnek',null,'TRY',10000::numeric,'2026-10-01'::date)`, [])).account_id as string;
    await as(ADV, "", "advisor");
    PERSONAL = (await rpc(`public.finance_account_create('user','bank','Kişisel banka',null,'TRY',0::numeric,'2026-10-01'::date)`, [])).account_id as string;
  });

  it("satırlar taslak olur; açılıştan önceki ve geçersiz satırlar atılır; mükerrer dosya reddedilir", async () => {
    await as(OWNER, FULL, "owner");
    const res = await stage(BANK, FILE("a"), [
      line(1, "2026-10-03", "out", 25000.5, "KIRA ODEMESI"),
      line(2, "2026-10-04", "in", 1500, "HAVALE GELEN"),
      line(3, "2026-10-05", "out", 300, "ELEKTRIK FATURASI"),
      line(4, "2026-09-01", "out", 10, "ACILISTAN ONCE"),
      { ...line(5, "2090-01-01", "in", 10, "GELECEK") },
      line(6, "2026-10-05", "in", 0, "SIFIR"),
    ]);
    expect(res.outcome).toBe("staged");
    expect(res.inserted).toBe(3);
    expect(res.invalid).toBe(3);
    imp1 = res.import_id as string;
    for (const n of [1, 2, 3]) lineIds[`l${n}`] = await lineId(H(n));
    expect((await stage(BANK, FILE("a"), [line(9, "2026-10-06", "in", 5, "x")])).outcome).toBe("duplicate_file");
  });

  it("çakışan ekstre yeni satır ekler, tekrarları sayar; hepsi tekrarsa nothing_new", async () => {
    await as(OWNER, FULL, "owner");
    const res = await stage(BANK, FILE("b"), [line(3, "2026-10-05", "out", 300, "ELEKTRIK FATURASI"), line(7, "2026-10-06", "in", 800, "KIRA TAHSILAT")]);
    expect(res.outcome).toBe("staged");
    expect(res.inserted).toBe(1);
    expect(res.duplicates).toBe(1);
    lineIds.l7 = await lineId(H(7));
    expect((await stage(BANK, FILE("c"), [line(3, "2026-10-05", "out", 300, "ELEKTRIK FATURASI")])).outcome).toBe("nothing_new");
    expect(await q(`select 1 from public.finance_statement_imports where file_hash = $1`, [FILE("c")])).toHaveLength(0);
  });

  it("hareket üretir (import kaynaklı, mutabık), mevcut hareketle eşler, atlar; ofis TL gideri expenses üretir", async () => {
    await as(OWNER, FULL, "owner");
    const existing = (await rpc(`public.finance_record_entry($1::uuid,'in',1500,'2026-10-04'::date,'diger_gelir','Havale',null,null,null,'manual',null,false,null)`, [BANK])).entry_id as string;
    const res = await apply(BANK, [
      { line_id: lineIds.l1, action: "create", category: "kira", title: "Ofis kirası", expense_category: "ofis" },
      { line_id: lineIds.l2, action: "match", entry_id: existing },
      { line_id: lineIds.l3, action: "skip" },
    ]);
    expect(res).toMatchObject({ outcome: "applied", created: 1, matched: 1, skipped: 1, failed: 0 });
    const e = (await q(`select source_type, source_id, reconciled_at, expense_id, kind, amount::float8 as amount from public.cash_entries where title = 'Ofis kirası'`))[0]!;
    expect(e.source_type).toBe("import");
    expect(e.source_id).toBe(lineIds.l1);
    expect(e.reconciled_at).not.toBeNull();
    expect(e.kind).toBe("expense");
    expect(e.expense_id).not.toBeNull();
    expect((await q(`select reconciled_at from public.cash_entries where id = $1`, [existing]))[0]!.reconciled_at).not.toBeNull();
    expect((await q(`select status from public.finance_statement_lines where id = $1`, [lineIds.l3]))[0]!.status).toBe("skipped");
  });

  it("işlenmiş satır ikinci kez işlenmez; tutarı uyuşmayan/zaten mutabık hareketle eşleşme reddedilir", async () => {
    await as(OWNER, FULL, "owner");
    const again = await apply(BANK, [{ line_id: lineIds.l1, action: "create", category: "kira" }]);
    expect(again).toMatchObject({ created: 0, failed: 1 });
    const other = (await rpc(`public.finance_record_entry($1::uuid,'in',999,'2026-10-06'::date,'diger_gelir','Başka tutar',null,null,null,'manual',null,false,null)`, [BANK])).entry_id as string;
    const bad = await apply(BANK, [{ line_id: lineIds.l7, action: "match", entry_id: other }]);
    expect(bad).toMatchObject({ matched: 0, failed: 1 });
    const ok = await apply(BANK, [{ line_id: lineIds.l7, action: "create", category: "kira_tahsilat" }]);
    expect(ok).toMatchObject({ created: 1, failed: 0 });
  });

  it("mutabakat durumu: son mutabakat, kapsam penceresindeki mutabık olmayan hareket sayısı", async () => {
    await as(OWNER, FULL, "owner");
    const st = (await q(`select * from public.finance_reconciliation_status() where account_id = $1`, [BANK]))[0]!;
    expect(st.has_import).toBe(true);
    expect(st.last_reconciled_at).not.toBeNull();
    // "Başka tutar" (999, 6 Eki) kapsam penceresinde ve mutabık değil.
    expect(Number(st.unreconciled_count)).toBe(1);
    expect(Number(st.pending_lines)).toBe(0);
  });

  it("maaş kategorisi yalnız owner/gm; tahsilat bağı ilgili modül yetkisi ister ve mükerrer bağlanmaz", async () => {
    await as(OWNER, FULL, "owner");
    const s = await stage(BANK, FILE("d"), [line(20, "2026-10-07", "out", 12000, "MAAS ODEMESI"), line(21, "2026-10-07", "in", 4500, "KIRA TAHSILATI"), line(22, "2026-10-08", "in", 4500, "KIRA TAHSILATI 2")]);
    expect(s.inserted).toBe(3);
    const l20 = await lineId(H(20)), l21 = await lineId(H(21)), l22 = await lineId(H(22));
    await as(ADV2, NOCOLLECT, "advisor");
    expect(await apply(BANK, [{ line_id: l20, action: "create", category: "maas" }])).toMatchObject({ created: 0, failed: 1 });
    expect(await apply(BANK, [{ line_id: l21, action: "create", category: "kira_tahsilat", source_type: "rent", source_id: RENT }])).toMatchObject({ created: 0, failed: 1 });
    await as(OWNER, FULL, "owner");
    expect(await apply(BANK, [{ line_id: l20, action: "create", category: "maas" }])).toMatchObject({ created: 1, failed: 0 });
    expect((await q(`select expense_id from public.cash_entries where category = 'maas'`))[0]!.expense_id).toBeNull();
    expect(await apply(BANK, [{ line_id: l21, action: "create", category: "kira_tahsilat", source_type: "rent", source_id: RENT }])).toMatchObject({ created: 1, failed: 0 });
    expect(await apply(BANK, [{ line_id: l22, action: "create", category: "kira_tahsilat", source_type: "rent", source_id: RENT }])).toMatchObject({ created: 0, failed: 1 });
  });

  it("kişisel hesap: yalnız sahibi taslağı görür/işler; ofis sahibi ve diğer üyeler göremez", async () => {
    await as(ADV, "", "advisor");
    const s = await stage(PERSONAL, FILE("e"), [line(30, "2026-10-05", "out", 75, "MARKET")]);
    expect(s.outcome).toBe("staged");
    const id = await lineId(H(30));
    expect(await q(`select 1 from public.finance_statement_lines`)).toHaveLength(1);
    await as(OWNER, FULL, "owner");
    expect((await q(`select id from public.finance_statement_lines where account_id = $1`, [PERSONAL]))).toHaveLength(0);
    expect((await stage(PERSONAL, FILE("f"), [line(31, "2026-10-05", "out", 1, "x")])).outcome).toBe("forbidden");
    expect(await apply(PERSONAL, [{ line_id: id, action: "skip" }])).toMatchObject({ outcome: "forbidden" });
    await as(ADV, "", "advisor");
    const ok = await apply(PERSONAL, [{ line_id: id, action: "create", category: "diger_gider" }]);
    expect(ok).toMatchObject({ created: 1 });
    // Kişisel hesapta gider kaydı (expenses) üretilmez.
    expect((await q(`select expense_id from public.cash_entries where account_id = $1`, [PERSONAL]))[0]!.expense_id).toBeNull();
    expect((await rpc(`public.finance_statement_mapping_save($1::uuid, '{"date":0,"description":1,"amount":2}'::jsonb)`, [PERSONAL])).outcome).toBe("saved");
    await as(OWNER, FULL, "owner");
    expect(await q(`select 1 from public.finance_statement_mappings where account_id = $1`, [PERSONAL])).toHaveLength(0);
  });

  it("tablolara doğrudan yazma yok; taslağı at yalnız bekleyen satırları siler", async () => {
    await as(OWNER, FULL, "owner");
    await expect(db.exec(`insert into public.finance_statement_lines(tenant_id, import_id, account_id, line_hash, line_date, direction, amount) values ('${T}', '${imp1}', '${BANK}', 'xxxxxxxxxx', '2026-10-05', 'in', 1)`)).rejects.toThrow();
    await expect(db.exec(`update public.cash_entries set reconciled_at = null`)).rejects.toThrow();
    const s = await stage(BANK, FILE("9"), [line(40, "2026-10-09", "in", 11, "Taslak")]);
    const d = await rpc(`public.finance_statement_discard($1::uuid)`, [s.import_id]);
    expect(d).toMatchObject({ outcome: "discarded", removed: 1 });
    expect(await q(`select 1 from public.finance_statement_imports where id = $1`, [s.import_id])).toHaveLength(0);
    // İşlenmiş satırı olan dosya kaydı korunur.
    expect((await rpc(`public.finance_statement_discard($1::uuid)`, [imp1])).outcome).toBe("discarded");
    expect(await q(`select 1 from public.finance_statement_imports where id = $1`, [imp1])).toHaveLength(1);
  });

  it("rollback tabloları, fonksiyonları ve sütunu düşürür; hareketler kalır", async () => {
    await db.exec(`reset role`);
    await db.exec(read("supabase/rollbacks/20261011001200_bank_statement_import.rollback.sql"));
    expect((await q(`select to_regclass('public.finance_statement_lines') as t`))[0]!.t).toBeNull();
    expect((await q(`select to_regprocedure('public.finance_statement_apply(uuid,jsonb)') as t`))[0]!.t).toBeNull();
    expect((await q(`select count(*)::int as n from information_schema.columns where table_name = 'cash_entries' and column_name = 'reconciled_at'`))[0]!.n).toBe(0);
    expect(Number((await q(`select count(*) as n from public.cash_entries`))[0]!.n)).toBeGreaterThan(0);
  });
});
