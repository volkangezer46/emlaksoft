import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012002700 — aktarım kodu TEK KULLANIMLIK ve SÜRELİ, oturum sahibine bağlı, kiracı sınırlı;
 * yayın sonrası baglama `lc_bind_portal_listing`'e gider (aynı ilan no başka portföye bağlanamaz). Gerçek RPC gövdeleri çalışır;
 * bağımlı çekirdek (bind, kapsam yardımcıları) sadeleştirilmiş taklittir.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select current_setting('t.role', true) $$;
create function public.has_effective_permission(m text, a text) returns boolean language sql stable as $$ select coalesce(current_setting('t.deny', true), '') <> m || ':' || a $$;
create function public.lc_row_visible(b uuid, t uuid, a uuid) returns boolean language sql stable as $$ select coalesce(current_setting('t.scope_deny', true), '') <> '1' $$;
create function public.lc_mark_state_stale(t uuid, p uuid) returns void language sql as $$ select 1 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, team_id uuid);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, branch_id uuid, assigned_to uuid, status text default 'live', deleted_at timestamptz);
create table public.portal_listings(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, portal_name text, portal_listing_id text, portal_url text,
  status text default 'live', source_kind text, created_via text);
create function public.lc_bind_portal_listing(t uuid, a uuid, p uuid, portal text, ext text, url text, sk text, cv text) returns jsonb language plpgsql as $$
declare ex public.portal_listings%rowtype; v uuid;
begin
  select * into ex from public.portal_listings where tenant_id = t and status = 'live' and lower(portal_name) = lower(portal) and portal_listing_id = ext;
  if found then
    if ex.property_id = p then return jsonb_build_object('outcome','replay','listing_id',ex.id); end if;
    return jsonb_build_object('outcome','bound_to_other_property','listing_id',ex.id);
  end if;
  insert into public.portal_listings(tenant_id, property_id, portal_name, portal_listing_id, portal_url, source_kind, created_via)
  values (t, p, portal, ext, url, sk, cv) returning id into v;
  return jsonb_build_object('outcome','applied','listing_id',v);
end $$;
`;

const hex = (c: string) => c.repeat(64).slice(0, 64);

describe.skipIf(!mod)("portal aktarım oturumu (pglite)", () => {
  let db: Db;
  let T1: string;
  let T2: string;
  let U1: string;
  let U2: string;
  let P1: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (tenant: string, uid: string, role = "advisor", deny = "", scopeDeny = "") => {
    await db.exec(`select set_config('t.tenant','${tenant}',false), set_config('t.uid','${uid}',false), set_config('t.role','${role}',false), set_config('t.deny','${deny}',false), set_config('t.scope_deny','${scopeDeny}',false)`);
  };
  const call = async (fn: string, args: unknown[]) => {
    const marks = args.map((_, i) => `$${i + 1}`).join(", ");
    return (await q(`select public.${fn}(${marks}) as r`, args))[0]!.r as Record<string, unknown>;
  };
  const prepare = (property: string, code: string, portal = "sahibinden", ttl = 120) =>
    call("pt_prepare_session", [property, portal, "export", code, null, ["bathrooms"], ttl]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    U1 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T1]))[0]!.id as string;
    U2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    P1 = (await q(`insert into public.properties(tenant_id, assigned_to) values ($1,$2) returning id`, [T1, U1]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261012002700_portal_transfer_sessions.sql"));
  });

  it("kod TEK KULLANIMLIK: ilk tüketim ok, ikinci 'used'", async () => {
    await as(T1, U1);
    expect(await prepare(P1, hex("a"))).toMatchObject({ outcome: "ok" });
    expect(await call("pt_consume_code", [hex("a")])).toMatchObject({ outcome: "ok", property_id: P1, portal: "sahibinden" });
    expect(await call("pt_consume_code", [hex("a")])).toMatchObject({ outcome: "used" });
  });

  it("kod SÜRELİ: süre dolunca 'expired' (oturum bırakılır); bilinmeyen kod 'invalid'", async () => {
    await as(T1, U1);
    await prepare(P1, hex("b"), "hepsiemlak");
    await db.exec(`update public.portal_transfer_sessions set expires_at = now() - interval '1 minute' where code_hash = '${hex("b")}'`);
    expect(await call("pt_consume_code", [hex("b")])).toMatchObject({ outcome: "expired" });
    expect((await q(`select state from public.portal_transfer_sessions where code_hash = $1`, [hex("b")]))[0]!.state).toBe("abandoned");
    expect(await call("pt_consume_code", [hex("c")])).toMatchObject({ outcome: "invalid" });
    expect(await call("pt_consume_code", ["kısa"])).toMatchObject({ outcome: "invalid_input" });
  });

  it("süre sınırı: ömür 5-240 dk arasına kırpılır", async () => {
    await as(T1, U1);
    await prepare(P1, hex("d"), "emlakjet", 100000);
    const row = (await q(`select extract(epoch from (expires_at - created_at))::int as s from public.portal_transfer_sessions where code_hash = $1`, [hex("d")]))[0]!;
    expect(row.s).toBeLessThanOrEqual(240 * 60 + 1);
  });

  it("KİRACI İZOLASYONU: başka ofisin portföyü hazırlanamaz, başka ofisin kodu tüketilemez, oturum görünmez", async () => {
    await as(T1, U1);
    await prepare(P1, hex("e"));
    await as(T2, U2);
    expect(await prepare(P1, hex("f"))).toMatchObject({ outcome: "property_not_found" });
    expect(await call("pt_consume_code", [hex("e")])).toMatchObject({ outcome: "invalid" });
    const sid = (await q(`select id from public.portal_transfer_sessions where code_hash = $1`, [hex("e")]))[0]!.id as string;
    expect(await call("pt_complete_session", [sid, "published", "1234567890", null, {}])).toMatchObject({ outcome: "invalid" });
  });

  it("kod oturum sahibine bağlı: aynı ofisteki başka kullanıcı tüketemez", async () => {
    await as(T1, U1);
    await prepare(P1, hex("1"));
    const other = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T1]))[0]!.id as string;
    await as(T1, other);
    expect(await call("pt_consume_code", [hex("1")])).toMatchObject({ outcome: "invalid" });
  });

  it("yetki ve kapsam kapıları: portals/edit yoksa forbidden; satır kapsamı dışı portföy bulunamaz; kapalı portföy reddedilir", async () => {
    await as(T1, U1, "advisor", "portals:edit");
    expect(await prepare(P1, hex("2"))).toMatchObject({ outcome: "forbidden" });
    expect(await call("pt_consume_code", [hex("2")])).toMatchObject({ outcome: "forbidden" });
    await as(T1, U1, "advisor", "", "1");
    expect(await prepare(P1, hex("3"))).toMatchObject({ outcome: "property_not_found" });
    await as(T1, U1);
    await db.exec(`update public.properties set status = 'sold' where id = '${P1}'`);
    expect(await prepare(P1, hex("4"))).toMatchObject({ outcome: "property_closed" });
    await db.exec(`update public.properties set status = 'live' where id = '${P1}'`);
  });

  it("yeni hazırlık eski açık oturumu bırakır (tek aktif oturum)", async () => {
    await as(T1, U1);
    await prepare(P1, hex("5"), "emlakjet");
    await prepare(P1, hex("6"), "emlakjet");
    expect((await q(`select state from public.portal_transfer_sessions where code_hash = $1`, [hex("5")]))[0]!.state).toBe("abandoned");
    expect(await call("pt_consume_code", [hex("5")])).toMatchObject({ outcome: "used" });
    expect(await call("pt_consume_code", [hex("6")])).toMatchObject({ outcome: "ok" });
  });

  it("yayın sonrası bağlama: ilan no zorunlu; uygulanır, tekrar 'replay'; başka portföye bağlı no reddedilir", async () => {
    await as(T1, U1);
    const P1b = (await q(`insert into public.properties(tenant_id, assigned_to) values ($1,$2) returning id`, [T1, U1]))[0]!.id as string;
    await prepare(P1, hex("7"), "sahibinden");
    const sid = (await q(`select id from public.portal_transfer_sessions where code_hash = $1`, [hex("7")]))[0]!.id as string;
    expect(await call("pt_complete_session", [sid, "published", "", null, {}])).toMatchObject({ outcome: "invalid_input" });
    const done = await call("pt_complete_session", [sid, "published", "1234567890", "https://www.sahibinden.com/ilan/1234567890/detay", { title: "planned" }]);
    expect(done).toMatchObject({ outcome: "ok", bind: "applied" });
    const row = (await q(`select source_kind, created_via, portal_name from public.portal_listings where portal_listing_id = '1234567890'`))[0]!;
    expect(row).toMatchObject({ source_kind: "assisted", created_via: "bind", portal_name: "Sahibinden" });
    expect(await call("pt_complete_session", [sid, "published", "1234567890", null, {}])).toMatchObject({ outcome: "replay" });
    // başka portföy için aynı ilan no
    await prepare(P1b, hex("8"), "sahibinden");
    const sid2 = (await q(`select id from public.portal_transfer_sessions where code_hash = $1`, [hex("8")]))[0]!.id as string;
    expect(await call("pt_complete_session", [sid2, "published", "1234567890", null, {}])).toMatchObject({ outcome: "bound_to_other_property" });
    expect((await q(`select state from public.portal_transfer_sessions where id = $1`, [sid2]))[0]!.state).toBe("prepared");
  });

  it("içe aktarma bağı: created_via 'import'; kod tabloda ham kod YOK, yalnız 64 hex özeti", async () => {
    await as(T1, U1);
    const P3 = (await q(`insert into public.properties(tenant_id, assigned_to) values ($1,$2) returning id`, [T1, U1]))[0]!.id as string;
    expect(await call("pt_import_bind", [P3, "hepsiemlak", "9876543210", "https://www.hepsiemlak.com/x/9876543210"])).toMatchObject({ outcome: "applied" });
    expect((await q(`select created_via, source_kind from public.portal_listings where portal_listing_id = '9876543210'`))[0]).toEqual({ created_via: "import", source_kind: "assisted" });
    expect(await call("pt_import_bind", [P3, "evilportal", "9876543210", null])).toMatchObject({ outcome: "invalid_input" });
    const rec = await call("pt_record_import", ["hepsiemlak", { created: 1 }]);
    expect(rec).toMatchObject({ outcome: "ok" });
    const bad = await q(`select count(*)::int n from public.portal_transfer_sessions where code_hash is not null and code_hash !~ '^[0-9a-f]{64}$'`);
    expect(bad[0]!.n).toBe(0);
  });

  it("tablo: doğrudan yazma politikası yok (yalnız select); service_role açık yetkili", async () => {
    const pol = await q(`select cmd from pg_policies where tablename = 'portal_transfer_sessions'`);
    expect(pol).toEqual([{ cmd: "SELECT" }]);
    const grants = await q(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'portal_transfer_sessions' and grantee in ('authenticated','service_role') order by 1,2`);
    const auth = grants.filter((g) => g.grantee === "authenticated").map((g) => g.privilege_type);
    expect(auth).toEqual(["SELECT"]);
    expect(grants.some((g) => g.grantee === "service_role" && g.privilege_type === "INSERT")).toBe(true);
  });
});
