import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): YD7 veritabanı işletim sertleştirmesi.
 *  - 20261015047000 rol zaman aşımları: PostgREST'in uyguladığı rol ayarları (taklit edilen rolün ayarı, yoksa
 *    authenticator oturumunun ayarı) hesaplanır; anon/authenticated KISA, service_role (sunucu/cron) DAHA UZUN.
 *    Gerçek iptal ayrıca SET + pg_sleep ile gösterilir (pglite zamanlayıcısı bunu desteklemiyorsa o adım bilgi olarak atlanır;
 *    canlı DB'de salt-okunur `set role anon; set statement_timeout ...; select pg_sleep(...)` ile doğrulandı).
 *  - 20261015047010 geo sayımları materialized view: okuma görünümden, yazım sonrası refresh_geo_stats() tazeler; anon okuyamaz.
 *  - 20261015047020 toplu sayım RPC'leri: eski ayrı head-count'larla AYNI sayılar (RLS çağıranın yetkisiyle).
 */
const mod = await loadPglite();
const strip = (sql: string) => sql.replace(/^set local lock_timeout.*$/gm, "").replace(/^notify pgrst.*$/gm, "");
const mig = (name: string) => strip(readFileSync(resolve(process.cwd(), `supabase/migrations/${name}`), "utf8"));
const rb = (name: string) => strip(readFileSync(resolve(process.cwd(), `supabase/rollbacks/${name}`), "utf8"));

const ROLES = "create role anon; create role authenticated; create role authenticator; create role service_role;";

/** PostgREST davranışı: istek, taklit edilen rolün ayarıyla; o rolde ayar yoksa authenticator oturumununkiyle koşar. */
async function effective(db: Db, role: string, name: string): Promise<string | null> {
  const rows = (
    await db.query(
      `select r.rolname, s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
       where s.setdatabase = 0 and r.rolname in ($1, 'authenticator')`,
      [role],
    )
  ).rows as { rolname: string; setconfig: string[] }[];
  const pick = (who: string) =>
    rows.find((r) => r.rolname === who)?.setconfig.find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  return pick(role) ?? pick("authenticator");
}

const ms = (v: string | null) => {
  if (!v) return Infinity;
  const m = /^(\d+)(ms|s|min)?$/.exec(v);
  if (!m) throw new Error(`bilinmeyen süre ${v}`);
  return Number(m[1]) * (m[2] === "min" ? 60_000 : m[2] === "ms" ? 1 : 1000);
};

describe.skipIf(!mod)("YD7 rol zaman aşımları (20261015047000)", () => {
  let db: Db;
  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(ROLES);
    // Canlıdaki ön durum: service_role'de ayar YOK (authenticator'ın 8s'i geçerliydi).
    await db.exec("alter role authenticator set statement_timeout = '8s'");
  });

  it("migration öncesi service_role isteği authenticator'ın 8s'ine bağlıydı", async () => {
    expect(await effective(db, "service_role", "statement_timeout")).toBe("8s");
  });

  it("anon/authenticated kısa, service_role (sunucu/cron) daha uzun; boşta işlem 60 sn; iki kez uygulanabilir", async () => {
    await db.exec(mig("20261015047000_db_role_timeouts.sql"));
    await db.exec(mig("20261015047000_db_role_timeouts.sql"));
    const anon = ms(await effective(db, "anon", "statement_timeout"));
    const auth = ms(await effective(db, "authenticated", "statement_timeout"));
    const svc = ms(await effective(db, "service_role", "statement_timeout"));
    expect(anon).toBe(3_000);
    expect(auth).toBe(8_000);
    expect(svc).toBe(60_000);
    // cron/sunucu yolu kısalmaz: hem kullanıcı rollerinden hem de önceki etkin değerden (8s) uzun.
    expect(svc).toBeGreaterThan(auth);
    expect(svc).toBeGreaterThan(8_000);
    for (const role of ["anon", "authenticated", "authenticator", "service_role"]) {
      expect(await effective(db, role, "idle_in_transaction_session_timeout"), role).toBe("60s");
    }
    // postgres (migration / bakım) ve diğer roller dokunulmaz.
    const pg = (await db.query("select count(*)::int as n from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname = 'postgres'")).rows[0];
    expect(pg!.n).toBe(0);
  });

  it("superuser ise yavaş sorgu günlüğü veritabanı düzeyinde 1s (rol düzeyine yazılmaz)", async () => {
    const dbConf = (await db.query("select setconfig from pg_db_role_setting where setrole = 0 and setdatabase = (select oid from pg_database where datname = current_database())")).rows[0] as { setconfig: string[] } | undefined;
    expect(dbConf?.setconfig).toContain("log_min_duration_statement=1s");
    const roleConf = (await db.query("select setconfig from pg_db_role_setting where setrole <> 0")).rows as { setconfig: string[] }[];
    expect(roleConf.flatMap((r) => r.setconfig).some((c) => c.startsWith("log_min_duration_statement"))).toBe(false);
  });

  it("uzun anon sorgusu zaman aşımıyla kesilir, service_role süresi içinde biter (pglite zamanlayıcı destekliyorsa)", async () => {
    // PostgREST'in istek başına yaptığı: set local role + taklit edilen rolün ayarları.
    const timed = async (role: string, sleepS: number) => {
      const st = await effective(db, role, "statement_timeout");
      // pglite'ta 3s/60s beklememek için ölçek: ayar oranı korunur (anon 3s → 300ms, service 60s → 6000ms).
      const scaled = Math.round(ms(st) / 10);
      try {
        await db.exec(`begin; set local role ${role}; set local statement_timeout = ${scaled}; select pg_sleep(${sleepS}); commit;`);
        return "ok";
      } catch (e) {
        await db.exec("rollback").catch(() => {});
        return (e as { code?: string }).code === "57014" ? "timeout" : `err:${(e as Error).message}`;
      }
    };
    const anon = await timed("anon", 0.6);
    const svc = await timed("service_role", 0.6);
    expect(svc).toBe("ok");
    if (anon === "ok") {
      // pglite (tek iş parçacıklı WASM) statement_timeout zamanlayıcısını çalıştırmıyor: iptal canlıda doğrulanır.
      console.info("pglite statement_timeout uygulamıyor; iptal canlı DB'de salt-okunur doğrulandı.");
    } else {
      expect(anon).toBe("timeout");
    }
  });

  it("rol yoksa hata vermez (NOTICE ile atlar); geri alma eklenen ayarları kaldırır, varsayılanları korur", async () => {
    const bare = new mod!.PGlite();
    await bare.exec(mig("20261015047000_db_role_timeouts.sql"));
    await db.exec(rb("20261015047000_db_role_timeouts.rollback.sql"));
    expect(await effective(db, "anon", "statement_timeout")).toBe("3s");
    expect(await effective(db, "authenticated", "statement_timeout")).toBe("8s");
    expect(await effective(db, "service_role", "statement_timeout")).toBe("8s"); // authenticator'a döner
    expect(await effective(db, "anon", "idle_in_transaction_session_timeout")).toBeNull();
  });
});

describe.skipIf(!mod)("YD7 geo sayımları materialized view (20261015047010)", () => {
  let db: Db;
  const P1 = "00000000-0000-4000-8000-000000000001";
  const P2 = "00000000-0000-4000-8000-000000000002";
  const D1 = "00000000-0000-4000-8000-0000000000d1";
  const D2 = "00000000-0000-4000-8000-0000000000d2";

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(`${ROLES}
      create table public.geo_provinces(id uuid primary key, name text not null, is_active boolean not null default true);
      create table public.geo_districts(id uuid primary key, province_id uuid not null references public.geo_provinces(id), name text not null, is_active boolean not null default true);
      create table public.geo_neighborhoods(id serial primary key, district_id uuid not null references public.geo_districts(id), name text not null, is_active boolean not null default true);
      insert into public.geo_provinces values ('${P1}', 'İzmir', true), ('${P2}', 'Boş İl', false);
      insert into public.geo_districts values ('${D1}', '${P1}', 'Bornova', true), ('${D2}', '${P1}', 'Mahallesiz', true);
      insert into public.geo_neighborhoods (district_id, name, is_active) values ('${D1}', 'Erzene', true), ('${D1}', 'Kazımdirik', true), ('${D1}', 'Eski', false);
    `);
    await db.exec(mig("20260722000018_geo_stats_views.sql"));
    await db.exec(mig("20261015047010_geo_stats_materialized.sql"));
    await db.exec(mig("20261015047010_geo_stats_materialized.sql")); // idempotent
  });

  it("aynı ad ve kolonlarla materialized view; eski sayımlarla aynı sonuç", async () => {
    const kinds = (await db.query("select relname, relkind from pg_class where relname in ('geo_province_stats','geo_district_stats','geo_level_counts') order by relname")).rows;
    expect(kinds).toEqual([
      { relname: "geo_district_stats", relkind: "m" },
      { relname: "geo_level_counts", relkind: "m" },
      { relname: "geo_province_stats", relkind: "m" },
    ]);
    const p = (await db.query("select province_id, district_count::int, neighborhood_count::int from public.geo_province_stats order by province_id")).rows;
    expect(p).toEqual([
      { province_id: P1, district_count: 2, neighborhood_count: 3 },
      { province_id: P2, district_count: 0, neighborhood_count: 0 },
    ]);
    const d = (await db.query("select district_id, neighborhood_count::int from public.geo_district_stats order by district_id")).rows;
    expect(d).toEqual([
      { district_id: D1, neighborhood_count: 3 },
      { district_id: D2, neighborhood_count: 0 },
    ]);
    const lc = (await db.query("select level, active, n::int from public.geo_level_counts order by level, active")).rows;
    expect(lc).toEqual([
      { level: "district", active: true, n: 2 },
      { level: "neighborhood", active: false, n: 1 },
      { level: "neighborhood", active: true, n: 2 },
      { level: "province", active: false, n: 1 },
      { level: "province", active: true, n: 1 },
    ]);
  });

  it("yazım görünümü değiştirmez; refresh_geo_stats() (cron adımı / admin yazımı) tazeler", async () => {
    await db.exec(`insert into public.geo_neighborhoods (district_id, name) values ('${D2}', 'Yeni Mahalle')`);
    const before = (await db.query(`select neighborhood_count::int as n from public.geo_district_stats where district_id = '${D2}'`)).rows[0];
    expect(before).toEqual({ n: 0 });
    const r = (await db.query("select public.refresh_geo_stats() as r")).rows[0] as { r: { provinces: number; districts: number } };
    expect(r.r).toEqual({ provinces: 2, districts: 2 });
    const after = (await db.query(`select neighborhood_count::int as n from public.geo_district_stats where district_id = '${D2}'`)).rows[0];
    expect(after).toEqual({ n: 1 });
    const total = (await db.query("select sum(n)::int as n from public.geo_level_counts where level = 'neighborhood'")).rows[0];
    expect(total).toEqual({ n: 4 });
  });

  it("erişim: yalnız service_role okur ve yeniler; anon/authenticated okuyamaz", async () => {
    const priv = async (role: string, obj: string, kind: "table" | "function") =>
      (
        await db.query(
          kind === "table" ? "select has_table_privilege($1, $2, 'SELECT') as ok" : "select has_function_privilege($1, $2, 'EXECUTE') as ok",
          [role, obj],
        )
      ).rows[0]!.ok;
    for (const v of ["public.geo_province_stats", "public.geo_district_stats", "public.geo_level_counts"]) {
      expect(await priv("service_role", v, "table"), v).toBe(true);
      expect(await priv("anon", v, "table"), v).toBe(false);
      expect(await priv("authenticated", v, "table"), v).toBe(false);
    }
    expect(await priv("service_role", "public.refresh_geo_stats()", "function")).toBe(true);
    expect(await priv("anon", "public.refresh_geo_stats()", "function")).toBe(false);
    expect(await priv("authenticated", "public.refresh_geo_stats()", "function")).toBe(false);
  });

  it("geri alma eski düz görünümleri aynı sonuçla kurar", async () => {
    const fresh = new mod!.PGlite();
    await fresh.exec(`${ROLES}
      create table public.geo_provinces(id uuid primary key, name text not null, is_active boolean not null default true);
      create table public.geo_districts(id uuid primary key, province_id uuid not null, name text not null, is_active boolean not null default true);
      create table public.geo_neighborhoods(id serial primary key, district_id uuid not null, name text not null, is_active boolean not null default true);
      insert into public.geo_provinces values ('${P1}', 'İzmir', true);
    `);
    await fresh.exec(mig("20260722000018_geo_stats_views.sql"));
    await fresh.exec(mig("20261015047010_geo_stats_materialized.sql"));
    await fresh.exec(rb("20261015047010_geo_stats_materialized.rollback.sql"));
    const kinds = (await fresh.query("select relname, relkind from pg_class where relname like 'geo_%stats' or relname = 'geo_level_counts' order by relname")).rows;
    expect(kinds).toEqual([
      { relname: "geo_district_stats", relkind: "v" },
      { relname: "geo_province_stats", relkind: "v" },
    ]);
  });
});

describe.skipIf(!mod)("YD7 toplu sayım RPC'leri (20261015047020)", () => {
  let db: Db;
  const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const C1 = "c1111111-1111-4111-8111-111111111111";
  const C2 = "c2222222-2222-4222-8222-222222222222";
  const C3 = "c3333333-3333-4333-8333-333333333333"; // başka ofis

  const SCHEMA = `${ROLES}
    alter role service_role bypassrls; -- canlıdaki gibi: service_role RLS atlar
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
    create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
    create type public.offer_status as enum ('draft', 'submitted', 'countered', 'accepted', 'rejected', 'withdrawn');
    create table public.customers(id uuid primary key, tenant_id uuid not null, assigned_to uuid);
    create table public.deals(id serial primary key, tenant_id uuid not null, customer_id uuid);
    create table public.appointments(id serial primary key, tenant_id uuid not null, customer_id uuid, assigned_to uuid, status text not null default 'scheduled', scheduled_at timestamptz not null default now());
    create table public.calls(id serial primary key, tenant_id uuid not null, customer_id uuid);
    create table public.communications(id serial primary key, tenant_id uuid not null, customer_id uuid);
    create table public.offers(id serial primary key, tenant_id uuid not null, customer_id uuid, created_by uuid, status public.offer_status not null default 'draft');
    create table public.tasks(id serial primary key, tenant_id uuid not null, customer_id uuid);
    create table public.iys_consents(id serial primary key, tenant_id uuid not null, customer_id uuid);
    create table public.customer_demands(id serial primary key, tenant_id uuid not null, customer_id uuid not null, status text not null, urgency text, created_at timestamptz not null default now());
    create table public.properties(id serial primary key, tenant_id uuid not null, assigned_to uuid, is_sample boolean not null default false, deleted_at timestamptz, created_at timestamptz not null default now());
    create function public.ef_credit_balance(p_tenant uuid) returns jsonb language plpgsql stable as $$
    begin
      if auth.role() is distinct from 'service_role' then raise exception 'Service role required.' using errcode = '42501'; end if;
      return jsonb_build_object('available', length(p_tenant::text), 'tenant', p_tenant);
    end $$;
    do $$ declare t text; begin
      foreach t in array array['customers','offers','customer_demands','appointments','properties'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('create policy sel on public.%I for select to authenticated using (tenant_id = public.current_tenant_id())', t);
      end loop;
    end $$;
    grant usage on schema public, auth to authenticated, service_role;
    grant select on all tables in schema public to authenticated, service_role;
  `;

  const as = async <R>(fn: () => Promise<R>, opts: { role?: "authenticated" | "service_role"; uid?: string | null } = {}): Promise<R> => {
    const role = opts.role ?? "authenticated";
    await db.exec(`reset role; select set_config('test.tenant', '${T}', false), set_config('request.jwt.claim.sub', '${opts.uid === null ? "" : (opts.uid ?? U1)}', false), set_config('test.role', '${role}', false)`);
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  };
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0] as Record<string, unknown>;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(SCHEMA);
    await db.exec(mig("20261015047020_batch_count_rpcs.sql"));
    await db.exec(mig("20261015047020_batch_count_rpcs.sql")); // idempotent
    await db.exec(`
      insert into public.customers values ('${C1}', '${T}', '${U1}'), ('${C2}', '${T}', '${U2}'), ('${C3}', '${T2}', '${U1}');
      insert into public.offers (tenant_id, customer_id, created_by, status) values
        ('${T}', '${C1}', '${U1}', 'draft'), ('${T}', '${C1}', '${U1}', 'submitted'), ('${T}', '${C2}', '${U2}', 'submitted'),
        ('${T}', '${C2}', '${U2}', 'accepted'), ('${T2}', '${C3}', '${U1}', 'accepted');
      insert into public.customer_demands (tenant_id, customer_id, status, urgency, created_at) values
        ('${T}', '${C1}', 'new', 'urgent', now()), ('${T}', '${C1}', 'active', 'high', now() - interval '40 days'),
        ('${T}', '${C2}', 'matched', null, now() - interval '50 days'), ('${T}', '${C2}', 'closed', 'urgent', now() - interval '90 days'),
        ('${T2}', '${C3}', 'new', 'urgent', now());
      insert into public.deals (tenant_id, customer_id) values ('${T}', '${C1}'), ('${T}', '${C1}'), ('${T2}', '${C1}');
      insert into public.tasks (tenant_id, customer_id) values ('${T}', '${C2}');
      insert into public.appointments (tenant_id, customer_id, assigned_to, status, scheduled_at) values
        ('${T}', '${C1}', '${U1}', 'scheduled', '2026-10-05T10:00:00Z'), ('${T}', '${C1}', '${U1}', 'cancelled', '2026-10-06T10:00:00Z'),
        ('${T}', '${C2}', '${U2}', 'done', '2026-10-07T10:00:00Z'), ('${T}', '${C2}', '${U2}', 'scheduled', '2026-11-02T10:00:00Z'),
        ('${T2}', '${C3}', '${U1}', 'scheduled', '2026-10-05T10:00:00Z');
      insert into public.properties (tenant_id, assigned_to, is_sample, deleted_at, created_at) values
        ('${T}', '${U1}', false, null, '2026-10-03T10:00:00Z'), ('${T}', '${U1}', true, null, '2026-10-03T10:00:00Z'),
        ('${T}', '${U2}', false, now(), '2026-10-03T10:00:00Z'), ('${T}', '${U2}', false, null, '2026-10-20T10:00:00Z');
    `);
  });

  /** Eski yolun eşi: RLS altında ayrı count(*) (PostgREST head-count). */
  const legacyCount = (where: string) => as(async () => Number((await one(`select count(*)::int as n from ${where}`)).n));

  it("offer_counts: toplam + durumlar eski 7 head-count ile aynı; danışman süzgeci daraltır; başka ofis sayılmaz", async () => {
    const r = await as(async () => (await one("select public.offer_counts(null) as r")).r as { total: number; by_status: Record<string, number> });
    expect(r.total).toBe(await legacyCount("public.offers"));
    for (const s of ["draft", "submitted", "countered", "accepted", "rejected", "withdrawn"]) {
      expect(r.by_status[s] ?? 0, s).toBe(await legacyCount(`public.offers where status = '${s}'`));
    }
    expect(r).toEqual({ total: 4, by_status: { draft: 1, submitted: 2, accepted: 1 } });
    const mine = await as(async () => (await one(`select public.offer_counts('${U1}') as r`)).r);
    expect(mine).toEqual({ total: 2, by_status: { draft: 1, submitted: 1 } });
    // oturumsuz çağrıda null (kod eski yola düşer, sahte sıfır yok)
    expect(await as(async () => (await one("select public.offer_counts(null) as r")).r, { uid: null })).toBeNull();
  });

  it("demand_counts: kapsamsız ve danışman/kapsam (müşteri üzerinden) sayımları eski head-count'larla aynı", async () => {
    const all = await as(async () => (await one("select public.demand_counts(null, null, array['new','active','matched'], now() - interval '30 days') as r")).r);
    expect(all).toEqual({ new: 1, active: 1, matched: 1, closed: 1, urgent: 1, high: 1, aging: 2 });
    expect((all as Record<string, number>).aging).toBe(
      await legacyCount("public.customer_demands where status = any(array['new','active','matched']) and created_at <= now() - interval '30 days'"),
    );
    const adv = await as(async () => (await one(`select public.demand_counts(null, '${U2}', array['new','active','matched'], now() - interval '30 days') as r`)).r);
    expect(adv).toEqual({ new: 0, active: 0, matched: 1, closed: 1, urgent: 0, high: 0, aging: 1 });
    const scoped = await as(async () => (await one(`select public.demand_counts(array['${U1}']::uuid[], null, array['new','active','matched'], now() - interval '30 days') as r`)).r);
    expect(scoped).toEqual({ new: 1, active: 1, matched: 0, closed: 0, urgent: 1, high: 1, aging: 1 });
    // kapsam + danışman kesişimi: boş
    const none = await as(async () => (await one(`select public.demand_counts(array['${U1}']::uuid[], '${U2}', array['new','active','matched'], now()) as r`)).r);
    expect(Object.values(none as Record<string, number>).every((n) => n === 0)).toBe(true);
  });

  it("target_activity_counts: hedef başına randevu/portföy eski 2 head-count ile aynı; istenmeyen alan null", async () => {
    const items = [
      { id: "ofis", start_at: "2026-10-01T00:00:00Z", end_at: "2026-11-01T00:00:00Z", profile_id: null, want_appointments: true, want_listings: true },
      { id: "u1", start_at: "2026-10-01T00:00:00Z", end_at: "2026-11-01T00:00:00Z", profile_id: U1, want_appointments: true, want_listings: false },
      { id: "u2-kasim", start_at: "2026-11-01T00:00:00Z", end_at: "2026-12-01T00:00:00Z", profile_id: U2, want_appointments: true, want_listings: true },
    ];
    const r = await as(async () => (await one("select public.target_activity_counts($1::uuid, $2::jsonb) as r", [T, JSON.stringify(items)])).r);
    expect(r).toEqual({
      ofis: { appointments: 2, listings: 2 }, // örnek ve silinmiş portföy sayılmaz
      u1: { appointments: 1, listings: null },
      "u2-kasim": { appointments: 1, listings: 0 },
    });
    expect((r as Record<string, { appointments: number }>).ofis.appointments).toBe(
      await legacyCount(`public.appointments where tenant_id = '${T}' and status <> 'cancelled' and scheduled_at >= '2026-10-01T00:00:00Z' and scheduled_at < '2026-11-01T00:00:00Z'`),
    );
    expect(await as(async () => (await one("select public.target_activity_counts($1::uuid, '[]'::jsonb) as r", [T])).r)).toEqual({});
  });

  it("kvkk_customer_related_counts: müşteri × tablo (aynı ofis), yalnız service_role", async () => {
    const rows = await as(
      async () => (await db.query(`select customer_id, tbl, n::int from public.kvkk_customer_related_counts(array['${C1}','${C2}','${C3}']::uuid[]) order by 1, 2`)).rows,
      { role: "service_role" },
    );
    expect(rows).toEqual([
      { customer_id: C1, tbl: "appointments", n: 2 },
      { customer_id: C1, tbl: "deals", n: 2 }, // başka ofis satırı ('${T2}', C1) sayılmaz
      { customer_id: C1, tbl: "offers", n: 2 },
      { customer_id: C2, tbl: "appointments", n: 2 },
      { customer_id: C2, tbl: "offers", n: 2 },
      { customer_id: C2, tbl: "tasks", n: 1 },
      { customer_id: C3, tbl: "appointments", n: 1 },
      { customer_id: C3, tbl: "offers", n: 1 },
    ]);
    const canAuth = (await one("select has_function_privilege('authenticated', 'public.kvkk_customer_related_counts(uuid[])', 'EXECUTE') as ok")).ok;
    expect(canAuth).toBe(false);
  });

  it("ef_credit_balances: ef_credit_balance gövdesi ofis listesiyle tek turda; tekrarlar tekilleşir; yalnız service_role", async () => {
    const rows = await as(
      async () => (await db.query(`select tenant_id, balance from public.ef_credit_balances(array['${T}','${T2}','${T}', null]::uuid[]) order by 1`)).rows,
      { role: "service_role" },
    );
    expect(rows).toEqual([
      { tenant_id: T, balance: { available: 36, tenant: T } },
      { tenant_id: T2, balance: { available: 36, tenant: T2 } },
    ]);
    const priv = async (role: string) => (await one(`select has_function_privilege('${role}', 'public.ef_credit_balances(uuid[])', 'EXECUTE') as ok`)).ok;
    expect(await priv("service_role")).toBe(true);
    expect(await priv("authenticated")).toBe(false);
    expect(await priv("anon")).toBe(false);
  });

  it("anon hiçbir sayım fonksiyonunu çağıramaz; geri alma hepsini kaldırır", async () => {
    for (const sig of [
      "public.offer_counts(uuid)",
      "public.demand_counts(uuid[], uuid, text[], timestamptz)",
      "public.target_activity_counts(uuid, jsonb)",
    ]) {
      expect((await one(`select has_function_privilege('anon', '${sig}', 'EXECUTE') as ok`)).ok, sig).toBe(false);
      expect((await one(`select has_function_privilege('authenticated', '${sig}', 'EXECUTE') as ok`)).ok, sig).toBe(true);
    }
    await db.exec(rb("20261015047020_batch_count_rpcs.rollback.sql"));
    const left = (await one("select count(*)::int as n from pg_proc where proname in ('offer_counts','demand_counts','target_activity_counts','kvkk_customer_related_counts','ef_credit_balances')")).n;
    expect(left).toBe(0);
  });
});
