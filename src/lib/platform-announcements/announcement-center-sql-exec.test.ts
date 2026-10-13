import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013004700_platform_announcement_center — teslim sahiplenme (SKIP LOCKED, çift
 * alım yok), okundu tetikleyicisi (yalnız meta.pad), tıklama RPC'si, banner hedefleme/tarih RLS'i, kapatma kuralı,
 * Yenilikler okunmamış sayısı ve geri alma.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create function public.is_platform_staff() returns boolean language sql stable as $$ select coalesce(current_setting('t.staff', true), '') = '1' $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), status text default 'active');
create table public.profiles(id uuid primary key, tenant_id uuid references public.tenants(id));
create table public.platform_staff(id uuid primary key default gen_random_uuid());
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid,
  title text not null, read_at timestamptz, meta jsonb not null default '{}'::jsonb);
create table public.platform_announcements (
  id uuid primary key default gen_random_uuid(), title text not null, body text,
  kind text not null default 'info', audience text not null default 'all'
    check (audience in ('all','active','trial','specific')),
  tenant_id uuid references public.tenants(id) on delete set null, sent_count integer not null default 0,
  created_by uuid references public.platform_staff(id) on delete set null, created_at timestamptz not null default now());
grant usage on schema public, auth to authenticated;
grant select, update on public.notifications to authenticated;
`;

describe.skipIf(!mod)("duyuru merkezi migration (pglite)", () => {
  let db: Db;
  let T1: string, T2: string, U1: string, U2: string, A: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const asUser = async (uid: string, tenant: string) => {
    await db.exec(`select set_config('t.uid', '${uid}', false), set_config('t.tenant', '${tenant}', false), set_config('t.staff', '', false)`);
    await db.exec("set role authenticated");
  };
  const asAdmin = () => db.exec("reset role");

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    U1 = "11111111-1111-4111-8111-111111111111";
    U2 = "22222222-2222-4222-8222-222222222222";
    await q(`insert into auth.users values ($1), ($2)`, [U1, U2]);
    await q(`insert into public.profiles values ($1, $2), ($3, $4)`, [U1, T1, U2, T2]);
    await db.exec(read("supabase/migrations/20261013004700_platform_announcement_center.sql"));
    A = (await q(`insert into public.platform_announcements(title, audience, status, channels, href) values ('Duyuru', 'segment', 'sending', array['in_app','email'], '/app/ayarlar') returning id`))[0]!.id as string;
    await q(
      `insert into public.platform_announcement_deliveries(announcement_id, tenant_id, user_id, channel)
       values ($1, $2, $3, 'in_app'), ($1, $4, $5, 'in_app'), ($1, $2, $3, 'email')`,
      [A, T1, U1, T2, U2],
    );
  });

  it("eski satırlar 'sent' kalır, audience 'segment'/'user' kabul edilir, geçersiz kanal reddedilir", async () => {
    const legacy = await q(`insert into public.platform_announcements(title) values ('eski') returning status, channels`);
    expect(legacy[0]).toMatchObject({ status: "sent", channels: ["in_app"] });
    await expect(q(`insert into public.platform_announcements(title, channels) values ('x', array['sms'])`)).rejects.toThrow();
    await expect(q(`insert into public.platform_announcements(title, href) values ('x', '//evil.example')`)).rejects.toThrow();
  });

  it("aynı alıcı-kanal iki kez yazılamaz (benzersiz anahtar)", async () => {
    await expect(
      q(`insert into public.platform_announcement_deliveries(announcement_id, tenant_id, user_id, channel) values ($1, $2, $3, 'in_app')`, [A, T1, U1]),
    ).rejects.toThrow();
  });

  it("sahiplenme: ikinci çağrı aynı satırları ALMAZ; deneme sayısı artar", async () => {
    const first = await q(`select id, status, attempts from public.platform_announcement_claim(2, null)`);
    expect(first).toHaveLength(2);
    expect(first.every((r) => r.status === "sending" && r.attempts === 1)).toBe(true);
    const second = await q(`select id from public.platform_announcement_claim(10, $1)`, [A]);
    expect(second).toHaveLength(1);
    expect(first.map((r) => r.id)).not.toContain(second[0]!.id);
    const third = await q(`select id from public.platform_announcement_claim(10, null)`);
    expect(third).toHaveLength(0);
  });

  it("okundu tetikleyicisi yalnız meta.pad taşıyan bildirimde çalışır ve sayacı bir kez artırır", async () => {
    const d = (await q(`select id from public.platform_announcement_deliveries where user_id = $1 and channel = 'in_app'`, [U1]))[0]!.id as string;
    const n = (await q(`insert into public.notifications(tenant_id, user_id, title, meta) values ($1, $2, 'Duyuru', jsonb_build_object('pad', $3::text)) returning id`, [T1, U1, d]))[0]!.id;
    const other = (await q(`insert into public.notifications(tenant_id, user_id, title) values ($1, $2, 'Başka') returning id`, [T1, U1]))[0]!.id;
    await asUser(U1, T1);
    await q(`update public.notifications set read_at = now() where id in ($1, $2)`, [n, other]);
    await asAdmin();
    const del = await q(`select read_at from public.platform_announcement_deliveries where id = $1`, [d]);
    expect(del[0]!.read_at).not.toBeNull();
    expect((await q(`select read_count from public.platform_announcements where id = $1`, [A]))[0]!.read_count).toBe(1);
  });

  it("tıklama: ilk tıklama sayılır, tekrar sayılmaz; duyurunun kendi bağlantısı döner", async () => {
    const d = (await q(`select id from public.platform_announcement_deliveries where user_id = $1 and channel = 'email'`, [U1]))[0]!.id as string;
    expect((await q(`select public.platform_announcement_track_click($1) as href`, [d]))[0]!.href).toBe("/app/ayarlar");
    await q(`select public.platform_announcement_track_click($1)`, [d]);
    const a = (await q(`select click_count, read_count from public.platform_announcements where id = $1`, [A]))[0]!;
    expect(a.click_count).toBe(1);
    expect(a.read_count).toBe(2); // e-posta tıklaması aynı zamanda okundu
    expect((await q(`select public.platform_announcement_track_click('00000000-0000-4000-8000-000000000000') as href`))[0]!.href).toBeNull();
  });

  it("banner: yalnız hedef ofiste ve tarih aralığında görünür; kapatılamaz banner kapatılamaz", async () => {
    await q(`insert into public.platform_banners(title, tenant_ids, dismissible) values ('Hedefli', array[$1]::uuid[], true)`, [T1]);
    await q(`insert into public.platform_banners(title, dismissible) values ('Herkese kalıcı', false)`);
    await q(`insert into public.platform_banners(title, starts_at) values ('Gelecek', now() + interval '1 day')`);
    await q(`insert into public.platform_banners(title, starts_at, ends_at) values ('Bitti', now() - interval '2 day', now() - interval '1 day')`);
    await asUser(U2, T2);
    const t2 = (await q(`select public.office_broadcast_state() as s`))[0]!.s as { banners: { title: string }[] };
    expect(t2.banners.map((b) => b.title)).toEqual(["Herkese kalıcı"]);
    await asAdmin();
    await asUser(U1, T1);
    const t1 = (await q(`select public.office_broadcast_state() as s`))[0]!.s as { banners: { id: string; title: string; dismissible: boolean }[] };
    expect(t1.banners.map((b) => b.title).sort()).toEqual(["Hedefli", "Herkese kalıcı"]);
    const fixed = t1.banners.find((b) => !b.dismissible)!;
    const target = t1.banners.find((b) => b.dismissible)!;
    await expect(q(`insert into public.platform_banner_dismissals(banner_id, user_id) values ($1, $2)`, [fixed.id, U1])).rejects.toThrow();
    await q(`insert into public.platform_banner_dismissals(banner_id, user_id) values ($1, $2)`, [target.id, U1]);
    await expect(q(`insert into public.platform_banner_dismissals(banner_id, user_id) values ($1, $2)`, [fixed.id, U2])).rejects.toThrow();
    const after = (await q(`select public.office_broadcast_state() as s`))[0]!.s as { banners: { title: string }[] };
    expect(after.banners.map((b) => b.title)).toEqual(["Herkese kalıcı"]);
    await asAdmin();
  });

  it("Yenilikler: yayınlanmış yeni girdi okunmamış sayılır; görülünce rozet söner; taslak/ileri tarih sayılmaz", async () => {
    await q(`insert into public.changelog_entries(title, published_at) values ('Yeni özellik', now() - interval '1 minute'), ('Taslak', null), ('Planlı', now() + interval '1 day')`);
    await asUser(U1, T1);
    const s1 = (await q(`select public.office_broadcast_state() as s`))[0]!.s as { changelog_unread: number };
    expect(s1.changelog_unread).toBe(1);
    expect((await q(`select title from public.changelog_entries`)).map((r) => r.title)).toEqual(["Yeni özellik"]);
    await q(`insert into public.changelog_reads(user_id, last_seen_at) values ($1, now())`, [U1]);
    const s2 = (await q(`select public.office_broadcast_state() as s`))[0]!.s as { changelog_unread: number };
    expect(s2.changelog_unread).toBe(0);
    await expect(q(`insert into public.changelog_reads(user_id) values ($1)`, [U2])).rejects.toThrow();
    await asAdmin();
  });

  it("geri alma temiz uygulanır ve eski kısıta döner", async () => {
    await db.exec(read("supabase/rollbacks/20261013004700_platform_announcement_center.rollback.sql"));
    const cols = await q(`select column_name from information_schema.columns where table_name = 'platform_announcements' and column_name = 'status'`);
    expect(cols).toHaveLength(0);
    expect(await q(`select to_regclass('public.platform_banners') as t`)).toEqual([{ t: null }]);
    await expect(q(`insert into public.platform_announcements(title, audience) values ('x', 'segment')`)).rejects.toThrow();
  });
});
