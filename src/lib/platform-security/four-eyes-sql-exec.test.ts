import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261014001300 — özel roller ve dört göz kuyruğu. Talep eden kendi talebine karar
 * veremez (CHECK), aynı kayıt için tek bekleyen talep, süper admin özel rol taşıyamaz, kullanımdaki rol silinemez,
 * ofis kullanıcısı (authenticated, personel değil) özel rolleri okuyamaz. Geri alma dosyası temiz düşürür.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table public.platform_staff(id uuid primary key, email text not null, full_name text not null default 'x',
  role text not null default 'support' check (role in ('super_admin','ops','support','billing')), is_active boolean not null default true,
  updated_at timestamptz default now());
create function public.is_platform_staff() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.platform_staff where id = auth.uid() and is_active) $$;
`;

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OFFICE = "33333333-3333-4333-8333-333333333333";
const MIG = "supabase/migrations/20261014001300_platform_custom_roles_four_eyes.sql";

const insertReq = (by: string, entity = "inv-1") =>
  `insert into public.platform_approval_requests(kind, module, entity_type, entity_id, summary, requested_by, expires_at)
   values ('refund', 'billing', 'invoice', '${entity}', 'İade 2500 TL', '${by}', now() + interval '1 day') returning id`;

describe.skipIf(!mod)("DG1 özel roller + dört göz (pglite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read(MIG));
    await db.exec(`insert into public.platform_staff(id, email, role) values ('${A}', 'a@x', 'super_admin'), ('${B}', 'b@x', 'ops');`);
  });

  it("talep eden kendi talebini onaylayamaz; başka biri onaylar", async () => {
    const { rows } = await db.query(insertReq(A));
    const id = rows[0]!.id;
    await expect(db.exec(`update public.platform_approval_requests set status = 'approved', decided_by = '${A}', decided_at = now() where id = '${id}'`)).rejects.toThrow(
      /platform_approval_four_eyes/,
    );
    await db.exec(`update public.platform_approval_requests set status = 'approved', decided_by = '${B}', decided_at = now() where id = '${id}'`);
    const after = await db.query(`select status from public.platform_approval_requests where id = '${id}'`);
    expect(after.rows[0]!.status).toBe("approved");
  });

  it("karar verilmiş durum karar veren ister; aynı kayıt için tek bekleyen talep", async () => {
    await expect(db.exec(`insert into public.platform_approval_requests(kind, module, entity_type, entity_id, summary, requested_by, expires_at, status)
      values ('refund','billing','invoice','inv-9','x x x','${A}', now(), 'rejected')`)).rejects.toThrow(/platform_approval_decided/);
    await db.query(insertReq(A, "inv-2"));
    await expect(db.query(insertReq(B, "inv-2"))).rejects.toThrow(/platform_approval_pending_uidx/);
  });

  it("süper admin özel rol taşıyamaz; kullanımdaki rol silinemez", async () => {
    const { rows } = await db.query(
      `insert into public.platform_custom_roles(label, base_role, permissions) values ('Finans onaylayıcı', 'billing', '{"billing":["approve"]}') returning id`,
    );
    const rid = rows[0]!.id;
    await expect(db.exec(`update public.platform_staff set custom_role_id = '${rid}' where id = '${A}'`)).rejects.toThrow(/platform_staff_custom_role_not_super/);
    await db.exec(`update public.platform_staff set custom_role_id = '${rid}', role = 'billing' where id = '${B}'`);
    await expect(db.exec(`delete from public.platform_custom_roles where id = '${rid}'`)).rejects.toThrow(/platform_staff_custom_role_id_fkey/);
    await expect(db.exec(`insert into public.platform_custom_roles(label, base_role) values ('Kötü', 'super_admin')`)).rejects.toThrow(/check/i);
  });

  it("RLS: personel özel rolleri okur, ofis kullanıcısı okuyamaz; kuyruk authenticated'a kapalı", async () => {
    await db.exec(`grant usage on schema public to authenticated; grant select on public.platform_staff to authenticated;`);
    await db.exec(`set role authenticated; select set_config('t.uid', '${B}', false);`);
    const staffRead = await db.query(`select count(*)::int as n from public.platform_custom_roles`);
    expect(staffRead.rows[0]!.n).toBeGreaterThan(0);
    await db.exec(`select set_config('t.uid', '${OFFICE}', false);`);
    const officeRead = await db.query(`select count(*)::int as n from public.platform_custom_roles`);
    expect(officeRead.rows[0]!.n).toBe(0);
    await expect(db.query(`select * from public.platform_approval_requests`)).rejects.toThrow(/permission denied/);
    await expect(db.exec(`insert into public.platform_custom_roles(label, base_role) values ('Sızma', 'ops')`)).rejects.toThrow(/permission denied/);
    await db.exec(`reset role;`);
  });

  it("geri alma temiz düşürür", async () => {
    const fresh = new mod!.PGlite();
    await fresh.exec(STUB);
    await fresh.exec(read(MIG));
    await fresh.exec(read("supabase/rollbacks/20261014001300_platform_custom_roles_four_eyes.rollback.sql"));
    const { rows } = await fresh.query(
      `select count(*)::int as n from information_schema.columns where table_name = 'platform_staff' and column_name = 'custom_role_id'`,
    );
    expect(rows[0]!.n).toBe(0);
    const t = await fresh.query(`select to_regclass('public.platform_approval_requests')::text as r`);
    expect(t.rows[0]!.r).toBeNull();
  });
});
