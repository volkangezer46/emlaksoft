import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261024030000_user_presence — ekip durumu RLS'i (aynı ofis okur, yalnız kendi satırını
 * yazar, bürünme yazamaz), updated_at/is_sample istemciden alınmaz, pasiflesen profilin durumu silinir, profil silinince
 * kaskat, office_last_backup yalnız zaman+durum döndürür ve ofis kimliği yoksa boştur; geri alma temiz çalışır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('t.jwt', true), ''), '{}')::jsonb $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key, tenant_id uuid references public.tenants(id), is_active boolean not null default true);
create table public.backup_runs(id bigint generated always as identity primary key, finished_at timestamptz not null default now(),
  status text not null, db_file text, size_bytes bigint, detail text);
grant usage on schema public, auth to authenticated;
`;

describe.skipIf(!mod)("ekip durumu migration (pglite)", () => {
  let db: Db;
  let T1: string, T2: string;
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const X = "33333333-3333-4333-8333-333333333333";
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const asUser = async (uid: string, tenant: string, jwt: Record<string, unknown> = { role: "authenticated" }) => {
    await db.exec(`select set_config('t.uid', '${uid}', false), set_config('t.tenant', '${tenant}', false), set_config('t.jwt', '${JSON.stringify(jwt)}', false)`);
    await db.exec("set role authenticated");
  };
  const asAdmin = async () => {
    await db.exec("reset role");
    await db.exec(`select set_config('t.uid', '', false), set_config('t.tenant', '', false), set_config('t.jwt', '{"role":"service_role"}', false)`);
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    await q(`insert into public.profiles(id, tenant_id) values ($1, $3), ($2, $3), ($4, $5)`, [A, B, T1, X, T2]);
    await q(`insert into public.backup_runs(finished_at, status, db_file, size_bytes, detail) values
      (now() - interval '2 days', 'ok', 'eski.sql.gz', 10, 'gizli'), (now() - interval '3 hours', 'ok', 'yeni.sql.gz', 20, 'gizli')`);
    await db.exec(read("supabase/migrations/20261024030000_user_presence.sql"));
  });

  it("kullanıcı kendi durumunu yazar; updated_at ve is_sample istemciden alınmaz", async () => {
    await asUser(A, T1);
    await q(`insert into public.user_presence(user_id, tenant_id, status, note, is_sample, updated_at) values ($1, $2, 'meeting', 'Moda', true, '2020-01-01')`, [A, T1]);
    const row = (await q(`select status, note, is_sample, updated_at > now() - interval '1 minute' as fresh from public.user_presence where user_id = $1`, [A]))[0]!;
    expect(row).toEqual({ status: "meeting", note: "Moda", is_sample: false, fresh: true });
    await q(`update public.user_presence set status = 'field' where user_id = $1`, [A]);
    expect((await q(`select status from public.user_presence where user_id = $1`, [A]))[0]!.status).toBe("field");
    await asAdmin();
  });

  it("başkası adına yazamaz, başka ofise yazamaz, bürünme oturumu yazamaz", async () => {
    await asUser(A, T1);
    await expect(q(`insert into public.user_presence(user_id, tenant_id, status) values ($1, $2, 'office')`, [B, T1])).rejects.toThrow();
    await expect(q(`insert into public.user_presence(user_id, tenant_id, status) values ($1, $2, 'office')`, [A, T2])).rejects.toThrow();
    await asAdmin();
    await q(`insert into public.user_presence(user_id, tenant_id, status) values ($1, $2, 'break')`, [B, T1]);
    await asUser(A, T1);
    const upd = await db.query(`update public.user_presence set status = 'away' where user_id = $1 returning 1`, [B]);
    expect(upd.rows).toHaveLength(0);
    const del = await db.query(`delete from public.user_presence where user_id = $1 returning 1`, [B]);
    expect(del.rows).toHaveLength(0);
    await asUser(B, T1, { role: "authenticated", app_metadata: { impersonating: "true" } });
    await expect(q(`update public.user_presence set status = 'office' where user_id = $1`, [B])).rejects.toThrow();
    await asAdmin();
    expect((await q(`select status from public.user_presence where user_id = $1`, [B]))[0]!.status).toBe("break");
  });

  it("geçersiz durum ve 60 karakterden uzun not reddedilir", async () => {
    await asUser(A, T1);
    await expect(q(`update public.user_presence set status = 'uykuda' where user_id = $1`, [A])).rejects.toThrow();
    await expect(q(`update public.user_presence set note = repeat('a', 61) where user_id = $1`, [A])).rejects.toThrow();
    await asAdmin();
  });

  it("aynı ofis okur, başka ofis göremez", async () => {
    await asUser(B, T1);
    expect((await q(`select user_id from public.user_presence order by user_id`)).map((r) => r.user_id)).toEqual([A, B]);
    await asUser(X, T2);
    expect(await q(`select user_id from public.user_presence`)).toEqual([]);
    await asAdmin();
  });

  it("service_role örnek satırı geçmiş zamanla yazabilir (demo tohumu)", async () => {
    await q(`insert into public.user_presence(user_id, tenant_id, status, is_sample, updated_at) values ($1, $2, 'office', true, '2026-10-01T09:00:00Z')`, [X, T2]);
    const r = (await q(`select is_sample, updated_at::text as at from public.user_presence where user_id = $1`, [X]))[0]!;
    expect(r.is_sample).toBe(true);
    expect(String(r.at)).toContain("2026-10-01");
  });

  it("profil pasifleşince durum silinir; profil silinince kaskat", async () => {
    await q(`update public.profiles set is_active = false where id = $1`, [B]);
    expect(await q(`select 1 from public.user_presence where user_id = $1`, [B])).toHaveLength(0);
    await q(`delete from public.profiles where id = $1`, [X]);
    expect(await q(`select 1 from public.user_presence where user_id = $1`, [X])).toHaveLength(0);
    expect(await q(`select 1 from public.user_presence where user_id = $1`, [A])).toHaveLength(1);
  });

  it("office_last_backup: yalnız son yedeğin zamanı + durumu; ofis kimliği yoksa boş", async () => {
    await asUser(A, T1);
    const rows = await q(`select * from public.office_last_backup()`);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["finished_at", "status"]);
    expect(rows[0]!.status).toBe("ok");
    await expect(q(`select * from public.backup_runs`)).rejects.toThrow();
    await asUser(A, "");
    expect(await q(`select * from public.office_last_backup()`)).toEqual([]);
    await asAdmin();
  });

  it("geri alma tüm nesneleri düşürür", async () => {
    await db.exec(read("supabase/rollbacks/20261024030000_user_presence.rollback.sql"));
    const left = await q(`select to_regclass('public.user_presence') as t, to_regprocedure('public.office_last_backup()') as f,
      (select count(*)::int from pg_trigger where tgname = 'trg_profiles_presence_clear') as trg`);
    expect(left[0]).toEqual({ t: null, f: null, trg: 0 });
  });
});
