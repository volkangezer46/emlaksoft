import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016050000_notification_reads — kişi başı okunma (ortak bildirim herkese ayrı),
 * kişisel read_at taşınması, notifications UPDATE yetkisinin kapanması, salt okunur dahil "Tümünü oku",
 * tek kaynak sayaç (my_notification_counts), 'reads:<uid>' yayını (deyim başına tek mesaj), duyuru teslim satırı
 * (meta.pad) ve geri alma.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key, tenant_id uuid references public.tenants(id), role text not null default 'advisor');
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  user_id uuid references public.profiles(id), title text not null, href text, kind text not null default 'info',
  read_at timestamptz, meta jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
alter table public.notifications enable row level security;
create policy notifications_tenant_select on public.notifications for select
  using (tenant_id = (select public.current_tenant_id()) and (user_id is null or user_id = (select auth.uid())));
create policy notifications_tenant_update on public.notifications for update
  using (tenant_id = (select public.current_tenant_id()) and (user_id is null or user_id = (select auth.uid())))
  with check (tenant_id = (select public.current_tenant_id()) and (user_id is null or user_id = (select auth.uid())));
create table public.platform_announcements(id uuid primary key default gen_random_uuid(), read_count integer not null default 0);
create table public.platform_announcement_deliveries(id uuid primary key default gen_random_uuid(),
  announcement_id uuid references public.platform_announcements(id), read_at timestamptz, updated_at timestamptz);
create schema realtime;
create table realtime.messages(id uuid primary key default gen_random_uuid(), topic text not null, extension text not null,
  payload jsonb, event text, private boolean);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql
  as $$ insert into realtime.messages(topic, extension, payload, event, private) values (topic, 'broadcast', payload, event, private) $$;
grant usage on schema public, auth, realtime to authenticated;
grant select, update on public.notifications to authenticated;
grant select on realtime.messages to authenticated;
`;

describe.skipIf(!mod)("bildirim okunma tablosu migration (pglite)", () => {
  let db: Db;
  let T1: string, T2: string, SHARED: string, SHARED_READ: string, OWN_READ: string, OWN_UNREAD: string, OTHERS: string, PAD: string, ANN: string, DEL: string;
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const RO = "33333333-3333-4333-8333-333333333333";
  const X = "44444444-4444-4444-8444-444444444444";
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const asUser = async (uid: string, tenant: string) => {
    await db.exec(`select set_config('t.uid', '${uid}', false), set_config('t.tenant', '${tenant}', false)`);
    await db.exec("set role authenticated");
  };
  const asAdmin = () => db.exec("reset role");
  const unread = async (uid: string, tenant: string) => {
    await asUser(uid, tenant);
    const r = await q(`select (public.my_notification_counts() ->> 'unread')::int as n`);
    await asAdmin();
    return r[0]!.n as number;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    await q(`insert into public.profiles(id, tenant_id, role) values ($1, $4, 'owner'), ($2, $4, 'advisor'), ($3, $4, 'readonly'), ($5, $6, 'owner')`, [U1, U2, RO, T1, X, T2]);
    const ins = async (tenant: string, user: string | null, title: string, readAt: string | null = null, meta = "{}") =>
      (await q(`insert into public.notifications(tenant_id, user_id, title, read_at, meta) values ($1, $2, $3, $4, $5::jsonb) returning id`, [tenant, user, title, readAt, meta]))[0]!.id as string;
    SHARED = await ins(T1, null, "Ortak");
    SHARED_READ = await ins(T1, null, "Ortak okunmuş (eski tek sütun)", "2026-10-01T10:00:00Z");
    OWN_READ = await ins(T1, U1, "Kişisel okunmuş", "2026-10-02T10:00:00Z");
    OWN_UNREAD = await ins(T1, U1, "Kişisel okunmamış");
    OTHERS = await ins(T2, null, "Başka ofis");
    ANN = (await q(`insert into public.platform_announcements default values returning id`))[0]!.id as string;
    DEL = (await q(`insert into public.platform_announcement_deliveries(announcement_id) values ($1) returning id`, [ANN]))[0]!.id as string;
    PAD = await ins(T1, U2, "Duyuru", null, JSON.stringify({ pad: DEL }));
    await db.exec(read("supabase/migrations/20261016050000_notification_reads.sql"));
  });

  it("kişisel read_at taşınır, ortak satırın tek read_at'i kimseye yazılmaz", async () => {
    const rows = await q(`select notification_id, user_id from public.notification_reads`);
    expect(rows).toEqual([{ notification_id: OWN_READ, user_id: U1 }]);
  });

  it("authenticated notifications'ı güncelleyemez (yetki + politika yok)", async () => {
    await asUser(U1, T1);
    await expect(q(`update public.notifications set title = 'x', href = '//evil' where id = $1`, [SHARED])).rejects.toMatchObject({ code: "42501" });
    await asAdmin();
    const pol = await q(`select count(*)::int as n from pg_policy where polrelid = 'public.notifications'::regclass and polcmd = 'w'`);
    expect(pol[0]!.n).toBe(0);
  });

  it("biri ortak bildirimi okuyunca diğerinde okunmamış kalır; sayaç tek kaynaktan", async () => {
    expect(await unread(U1, T1)).toBe(3); // Ortak, Ortak okunmuş (eski), Kişisel okunmamış
    expect(await unread(U2, T1)).toBe(3); // Ortak x2 + duyuru
    await asUser(U1, T1);
    expect((await q(`select public.mark_my_notifications_read(array[$1]::uuid[]) as n`, [SHARED]))[0]!.n).toBe(1);
    // aynı bildirim ikinci kez: yeni satır yok
    expect((await q(`select public.mark_my_notifications_read(array[$1]::uuid[]) as n`, [SHARED]))[0]!.n).toBe(0);
    await asAdmin();
    expect(await unread(U1, T1)).toBe(2);
    expect(await unread(U2, T1)).toBe(3);
  });

  it("başkasının kişisel bildirimine ya da başka ofisin bildirimine okuma yazılamaz", async () => {
    await asUser(U1, T1);
    await expect(q(`insert into public.notification_reads(tenant_id, notification_id, user_id) values ($1, $2, $3)`, [T1, PAD, U1])).rejects.toThrow();
    await expect(q(`insert into public.notification_reads(tenant_id, notification_id, user_id) values ($1, $2, $3)`, [T2, OTHERS, U1])).rejects.toThrow();
    await expect(q(`insert into public.notification_reads(tenant_id, notification_id, user_id) values ($1, $2, $3)`, [T1, SHARED_READ, U2])).rejects.toThrow();
    // RPC görünmeyen kimliği sessizce atlar
    expect((await q(`select public.mark_my_notifications_read(array[$1, $2]::uuid[]) as n`, [PAD, OTHERS]))[0]!.n).toBe(0);
    // başkasının okumasını göremez
    await asAdmin();
    await q(`insert into public.notification_reads(tenant_id, notification_id, user_id) values ($1, $2, $3)`, [T1, SHARED_READ, U2]);
    await asUser(U1, T1);
    expect((await q(`select count(*)::int as n from public.notification_reads where user_id = $1`, [U2]))[0]!.n).toBe(0);
    await asAdmin();
    await q(`delete from public.notification_reads where user_id = $1`, [U2]);
  });

  it("salt okunur dahil 'Tümünü oku' okunmamışı sıfırlar", async () => {
    expect(await unread(RO, T1)).toBe(2);
    await asUser(RO, T1);
    expect((await q(`select public.mark_my_notifications_read(null) as n`))[0]!.n).toBe(2);
    await asAdmin();
    expect(await unread(RO, T1)).toBe(0);
    expect(await unread(U1, T1)).toBe(2);
  });

  it("yayın: deyim başına kişi başına TEK mesaj, yalnız kendi konusu okunur", async () => {
    await q(`delete from realtime.messages`);
    await asUser(U2, T1);
    await q(`select public.mark_my_notifications_read(null)`);
    await asAdmin();
    const msgs = await q(`select topic, event, payload, private from realtime.messages`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ topic: `reads:${U2}`, event: "read", private: true });
    const payload = msgs[0]!.payload as { ids: string[]; n: number };
    expect(payload.n).toBe(3);
    expect([...payload.ids].sort()).toEqual([SHARED, SHARED_READ, PAD].sort());
    // Politika: yalnız kendi konusu
    await db.exec(`select set_config('realtime.topic', 'reads:${U2}', false)`);
    await asUser(U2, T1);
    expect((await q(`select count(*)::int as n from realtime.messages`))[0]!.n).toBe(1);
    await asAdmin();
    await asUser(U1, T1);
    expect((await q(`select count(*)::int as n from realtime.messages`))[0]!.n).toBe(0);
    await asAdmin();
  });

  it("duyuru teslim satırı ilk okunuşta okundu olur, sayaç bir kez artar", async () => {
    const d = await q(`select read_at from public.platform_announcement_deliveries where id = $1`, [DEL]);
    expect(d[0]!.read_at).not.toBeNull();
    expect((await q(`select read_count from public.platform_announcements where id = $1`, [ANN]))[0]!.read_count).toBe(1);
    await asUser(U2, T1);
    await q(`select public.mark_my_notifications_read(array[$1]::uuid[])`, [PAD]);
    await asAdmin();
    expect((await q(`select read_count from public.platform_announcements where id = $1`, [ANN]))[0]!.read_count).toBe(1);
  });

  it("sayaç: toplam, son 7 gün ve tür kırılımı", async () => {
    await asUser(U1, T1);
    const c = (await q(`select public.my_notification_counts() as c`))[0]!.c as { unread: number; total: number; week: number; kinds: Record<string, number> };
    await asAdmin();
    expect(c).toMatchObject({ total: 4, week: 4, unread: 2, kinds: { info: 4 } });
  });

  it("migration idempotent; geri alma eski yetkiyi ve kişisel read_at'i geri getirir", async () => {
    await db.exec(read("supabase/migrations/20261016050000_notification_reads.sql"));
    expect((await q(`select count(*)::int as n from public.notification_reads`))[0]!.n).toBe(7); // ikinci koşu kopya üretmez
    await asUser(U1, T1);
    await q(`select public.mark_my_notifications_read(array[$1]::uuid[])`, [OWN_UNREAD]);
    await asAdmin();
    await db.exec(read("supabase/rollbacks/20261016050000_notification_reads.rollback.sql"));
    expect((await q(`select to_regclass('public.notification_reads') as t`))[0]!.t).toBeNull();
    const own = await q(`select read_at from public.notifications where id = $1`, [OWN_UNREAD]);
    expect(own[0]!.read_at).not.toBeNull(); // kişisel okuma tek sütuna geri yazıldı
    await asUser(U1, T1);
    await expect(q(`update public.notifications set read_at = now() where id = $1`, [SHARED])).resolves.toBeTruthy();
    await asAdmin();
  });
});
