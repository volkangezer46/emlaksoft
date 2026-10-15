import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): SK1 migration'ları.
 *  - 20261016010000 finance_fx: SET'siz + nitelikli → çağıran sorguya İNLINE edilir (EXPLAIN VERBOSE'da fonksiyon çağrısı
 *    yok); sonuçlar eski gövdeyle birebir aynı.
 *  - 20261016010100 pgrst watch: yalnız public/storage/graphql_public DDL'i 'NOTIFY pgrst' üretir; sahibi olmayan rolde no-op.
 *  - 20261016010200 proxy_gate_snapshot.session_alive + staff_access: çıkış yapılmış / iptal edilmiş / süresi dolmuş /
 *    başkasının oturumu false; claim yoksa null; özel rol matrisi taşınır.
 *  - 20261016010300 platform_notification_feed: tek tur liste + okunmamış sayısı; çağıranın kendi bildirimleri (RLS).
 */
const mod = await loadPglite();
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (sql: string) => sql.replace(/^set local lock_timeout.*$/gm, "").replace(/^notify pgrst.*$/gm, "");

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S1 = "51515151-5151-4515-8515-515151515151";
const S2 = "52525252-5252-4525-8525-525252525252";
const R1 = "99999999-9999-4999-8999-999999999999";

const AUTH_SCHEMA = `
create role authenticated; create role anon; create role service_role;
create schema auth;
create table auth.sessions(id uuid primary key, user_id uuid not null, not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, service_role, anon;
grant usage on schema public to authenticated, service_role, anon;
create table public.profiles(id uuid primary key, tenant_id uuid, role text, is_active boolean, two_factor_sms boolean, phone text, two_factor_version int);
create table public.platform_custom_roles(id uuid primary key, label text, base_role text, permissions jsonb);
create table public.platform_staff(id uuid primary key, role text, is_active boolean, custom_role_id uuid references public.platform_custom_roles(id));
create table public.tenants(id uuid primary key, status text);
create table public.platform_notifications(id uuid primary key default gen_random_uuid(), staff_id uuid not null, title text not null,
  body text, href text, kind text not null default 'info', read_at timestamptz, meta jsonb not null default '{}', created_at timestamptz not null default now());
alter table public.profiles enable row level security;
alter table public.platform_staff enable row level security;
alter table public.platform_custom_roles enable row level security;
alter table public.platform_notifications enable row level security;
create policy n_self on public.platform_notifications for all to authenticated using (staff_id = auth.uid()) with check (staff_id = auth.uid());
create policy p_self on public.profiles for select to authenticated using (id = auth.uid());
create policy s_self on public.platform_staff for select to authenticated using (id = auth.uid());
create policy r_own on public.platform_custom_roles for select to authenticated
  using (exists (select 1 from public.platform_staff s where s.id = auth.uid() and s.custom_role_id = platform_custom_roles.id));
grant select on public.profiles, public.platform_staff, public.platform_custom_roles, public.tenants to authenticated;
grant select, update on public.platform_notifications to authenticated;
grant all on public.platform_notifications to service_role;
`;

describe.skipIf(!mod)("SK1 migration'ları (pglite)", () => {
  let db: Db;

  async function asUser(uid: string | null, jwt: Record<string, unknown>, role: "authenticated" | "service_role" | "anon" = "authenticated") {
    await db.exec("reset role");
    await db.query("select set_config('test.uid', $1, false), set_config('test.jwt', $2, false), set_config('test.role', $3, false)", [
      uid ?? "",
      JSON.stringify(jwt),
      role,
    ]);
    await db.exec(`set role ${role}`);
  }
  async function snapshot(uid: string, jwt: Record<string, unknown>) {
    await asUser(uid, { sub: uid, ...jwt });
    const r = (await db.query("select public.proxy_gate_snapshot($1::uuid, $2::uuid) as s", [uid, T1])).rows[0]!.s as Record<string, unknown>;
    await db.exec("reset role");
    return r;
  }

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(AUTH_SCHEMA);
    await db.exec(strip(read("supabase/migrations/20261016010200_proxy_gate_session_alive.sql")));
    await db.exec(strip(read("supabase/migrations/20261016010300_platform_notification_feed.sql")));
    await db.exec(`
      insert into public.tenants values ('${T1}', 'active');
      insert into public.profiles values ('${U1}', '${T1}', 'owner', true, false, null, 1);
      insert into public.platform_custom_roles values ('${R1}', 'Destek izleyici', 'ops', '{"tickets":["view"]}');
      insert into public.platform_staff values ('${U2}', 'ops', true, '${R1}');
      insert into auth.sessions values ('${S1}', '${U1}', null), ('${S2}', '${U2}', now() + interval '1 hour');
    `);
  });

  describe("proxy_gate_snapshot: session_alive + staff_access", () => {
    it("canlı oturum true; profil ve ofis durumu eskisi gibi", async () => {
      const s = await snapshot(U1, { session_id: S1 });
      expect(s).toMatchObject({ session_alive: true, staff: false, tenant_status: "active", staff_access: null });
      expect(s.profile).toMatchObject({ tenant_id: T1, role: "owner", is_active: true });
    });

    it("başkasının oturum kimliği false (oturum yoklama yüzeyi yok); claim yoksa / bozuksa null", async () => {
      expect((await snapshot(U1, { session_id: S2 })).session_alive).toBe(false);
      expect((await snapshot(U1, {})).session_alive).toBeNull();
      expect((await snapshot(U1, { session_id: "x' or 1=1" })).session_alive).toBeNull();
    });

    it("çıkış / iptal (satır silinir) ve süresi dolmuş oturum false", async () => {
      await db.exec(`update auth.sessions set not_after = now() - interval '1 second' where id = '${S1}'`);
      expect((await snapshot(U1, { session_id: S1 })).session_alive).toBe(false);
      await db.exec(`delete from auth.sessions where id = '${S1}'`);
      expect((await snapshot(U1, { session_id: S1 })).session_alive).toBe(false);
      await db.exec(`insert into auth.sessions values ('${S1}', '${U1}', null)`);
    });

    it("personel: özel rol matrisi staff_access'te (RLS: kendi rolü)", async () => {
      const s = await snapshot(U2, { session_id: S2 });
      expect(s.staff).toBe(true);
      expect(s.session_alive).toBe(true);
      expect(s.staff_access).toEqual({
        role: "ops",
        custom_role_id: R1,
        custom_role: { id: R1, label: "Destek izleyici", base_role: "ops", permissions: { tickets: ["view"] } },
      });
    });

    it("authenticated auth.sessions'ı doğrudan okuyamaz; anon session_alive çalıştıramaz", async () => {
      await asUser(U1, { sub: U1 });
      await expect(db.query("select count(*) from auth.sessions")).rejects.toThrow(/permission denied/);
      await asUser(null, {}, "anon");
      await expect(db.query(`select public.session_alive('${S1}'::uuid)`)).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    });
  });

  describe("platform_notification_feed", () => {
    beforeAll(async () => {
      await db.exec(`
        insert into public.platform_notifications (staff_id, title, read_at, created_at)
        select '${U2}', 'b' || g, case when g <= 5 then null else now() end, now() - (g || ' minutes')::interval
        from generate_series(1, 20) g;
        insert into public.platform_notifications (staff_id, title) values ('${U1}', 'baska');
      `);
    });

    it("tek tur: çağıranın son 15 bildirimi (yeniden eskiye) + okunmamış sayısı; limit 1..50", async () => {
      await asUser(U2, { sub: U2 });
      const feed = (await db.query("select public.platform_notification_feed(15) as f")).rows[0]!.f as {
        items: { title: string }[];
        unread: number;
      };
      expect(feed.unread).toBe(5);
      expect(feed.items).toHaveLength(15);
      expect(feed.items[0]!.title).toBe("b1");
      expect(Object.keys(feed.items[0]!).sort()).toEqual(["body", "created_at", "href", "id", "kind", "read_at", "title"]);
      const one = (await db.query("select public.platform_notification_feed(0) as f")).rows[0]!.f as { items: unknown[] };
      expect(one.items).toHaveLength(1);
      await db.exec("reset role");
    });

    it("RLS: başka personelin bildirimi görünmez; anon çalıştıramaz", async () => {
      await asUser(R1, { sub: R1 });
      expect((await db.query("select public.platform_notification_feed(15) as f")).rows[0]!.f).toEqual({ items: [], unread: 0 });
      await asUser(U1, { sub: U1 });
      const own = (await db.query("select public.platform_notification_feed(15) as f")).rows[0]!.f as { items: { title: string }[] };
      expect(own.items.map((i) => i.title)).toEqual(["baska"]);
      await asUser(null, {}, "anon");
      await expect(db.query("select public.platform_notification_feed(15)")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    });
  });
});

describe.skipIf(!mod)("finance_fx inline (20261016010000)", () => {
  let db: Db;
  const explain = async () =>
    ((await db.query("explain (verbose, costs off) select public.finance_fx(t.c, t.r) from t")).rows as { "QUERY PLAN": string }[])
      .map((r) => r["QUERY PLAN"])
      .join("\n");
  const values = async () =>
    (await db.query("select t.id, public.finance_fx(t.c, t.r)::text as v from t order by t.id")).rows;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table t(id serial primary key, c text, r jsonb);
      insert into t (c, r) values (null, null), ('TRY', null), ('USD', '{"USD": 32.5}'), ('USD', '{"USD": 0}'), ('USD', '{"USD": -1}'),
        ('EUR', '{"USD": 32.5}'), ('EUR', '{"EUR": "35"}'), ('EUR', null), ('GBP', '{"GBP": 41.25}'), ('try', '{"try": 2}');
    `);
    // Önceki gövde (20261014001100): SET search_path = '' → inline EDİLMEZ.
    await db.exec(strip(read("supabase/rollbacks/20261016010000_finance_fx_inline.rollback.sql")));
  });

  it("önce: SET taşıyan fonksiyon planda çağrı olarak kalır; sonra: CASE ifadesi satır içinde, sonuçlar aynı", async () => {
    const beforePlan = await explain();
    expect(beforePlan).toMatch(/finance_fx\(/);
    const before = await values();
    await db.exec(strip(read("supabase/migrations/20261016010000_finance_fx_inline.sql")));
    const afterPlan = await explain();
    expect(afterPlan).not.toMatch(/finance_fx\(/);
    expect(afterPlan).toMatch(/CASE/);
    expect(await values()).toEqual(before);
    const cfg = (await db.query("select proconfig from pg_proc where proname = 'finance_fx'")).rows[0]!.proconfig;
    expect(cfg).toBeNull();
  });

  it("çağıranın search_path'i kötü niyetli olsa da pg_catalog işleçleri kullanılır", async () => {
    await db.exec(`
      create schema evil;
      create function evil.eq_any(a text, b text) returns boolean language sql as $$ select true $$;
      create operator evil.= (leftarg = text, rightarg = text, function = evil.eq_any);
      set search_path = evil, public, pg_catalog;
    `);
    expect((await db.query("select public.finance_fx('USD', '{\"EUR\": 2}'::jsonb) as v")).rows[0]!.v).toBeNull();
    await db.exec("reset search_path");
  });
});

describe.skipIf(!mod)("pgrst watch kapsamı (20261016010100)", () => {
  let db: Db;
  let notes = 0;
  const ddl = async (sql: string) => {
    notes = 0;
    await db.exec(sql);
    await new Promise((r) => setTimeout(r, 20));
    return notes;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(`create schema extensions; create schema realtime; create schema storage; create role mig_runner;
      grant usage, create on schema public, realtime to mig_runner; grant usage on schema extensions to mig_runner;`);
    // Supabase'in özgün gövdesi (geri alma dosyası birebir onu kurar) + event trigger'lar.
    await db.exec(`
      create function extensions.pgrst_ddl_watch() returns event_trigger language plpgsql as $$ begin end $$;
      create function extensions.pgrst_drop_watch() returns event_trigger language plpgsql as $$ begin end $$;
    `);
    await db.exec(strip(read("supabase/rollbacks/20261016010100_pgrst_ddl_watch_scope.rollback.sql")));
    await db.exec(`
      create event trigger pgrst_ddl_watch on ddl_command_end execute procedure extensions.pgrst_ddl_watch();
      create event trigger pgrst_drop_watch on sql_drop execute procedure extensions.pgrst_drop_watch();
    `);
    await (db as unknown as { listen: (ch: string, cb: () => void) => Promise<unknown> }).listen("pgrst", () => {
      notes += 1;
    });
  });

  it("özgün gövde: realtime şemasındaki DDL de yeniden yükleme tetikler (sorunun kendisi)", async () => {
    expect(await ddl("create table realtime.messages_2026_10_16 (id int)")).toBe(1);
  });

  it("sahibi olmayan rol (migration aracı 'postgres' gibi): NOTICE + değişiklik yok", async () => {
    await db.exec("set role mig_runner");
    await db.exec(strip(read("supabase/migrations/20261016010100_pgrst_ddl_watch_scope.sql")));
    await db.exec("reset role");
    expect(await ddl("create table realtime.messages_2026_10_17 (id int)")).toBe(1);
  });

  it("sahip ile uygulanınca: yalnız public/storage/graphql_public DDL'i yeniden yükler", async () => {
    await db.exec(strip(read("supabase/migrations/20261016010100_pgrst_ddl_watch_scope.sql")));
    expect(await ddl("create table realtime.messages_2026_10_18 (id int)")).toBe(0);
    expect(await ddl("drop table realtime.messages_2026_10_16")).toBe(0);
    expect(await ddl("create schema cron_ic")).toBe(0);
    expect(await ddl("create table public.yeni (id int)")).toBe(1);
    expect(await ddl("create function public.f() returns int language sql as $$ select 1 $$")).toBe(1);
    expect(await ddl("comment on table public.yeni is 'x'")).toBe(1);
    expect(await ddl("create table storage.nesne (id int)")).toBe(1);
    expect(await ddl("drop table public.yeni")).toBe(1);
    expect(await ddl("drop function public.f()")).toBe(1);
    // Tek DDL'de birden çok komut: tek bildirim.
    expect(await ddl("create table public.cok (id int primary key, ad text unique)")).toBe(1);
  });

  it("idempotent: ikinci kez uygulamak davranışı değiştirmez", async () => {
    await db.exec(strip(read("supabase/migrations/20261016010100_pgrst_ddl_watch_scope.sql")));
    expect(await ddl("create table realtime.messages_2026_10_19 (id int)")).toBe(0);
    expect(await ddl("alter table public.cok add column z int")).toBe(1);
  });
});
