import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013007100 — EİDS yetki defteri.
 * - Olay tablosuna doğrudan INSERT yok: danışman kendi uid'iyle bile sahte override/undo ekleyemez.
 * - Override yalnız owner (RPC), portföyü değiştiren olay properties:edit ister, kiracı JWT'den.
 * - Veriliş tarihi authorization_start'a yazılır ve geri alınır.
 * - Geri alma yalnız olayın değiştirdiği alanları döndürür; o alanlar defter dışından değiştiyse reddeder.
 * - Taşınmaz no rakam anahtarıyla birebir arama (ayraçlı kayıt "EIDS-34-4410-0141").
 * Bağımlı çekirdek tablolar sadeleştirilmiş kopyadır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.authrole', true), ''), 'authenticated') $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text, deleted_at timestamptz);
create table public.properties(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id), property_code text, title text,
  status text default 'live', transaction_type text default 'sale', district_id uuid, neighborhood_id uuid, owner_customer_id uuid,
  eids_property_no text, authorization_start date, authorization_end date, deleted_at timestamptz, created_at timestamptz default now(),
  authority_eids_status text not null default 'pending', authority_owner_approved_at timestamptz,
  constraint properties_authority_eids_status_check check (authority_eids_status in ('pending', 'approved', 'rejected')));
create table public.property_owner_info(property_id uuid, tenant_id uuid, customer_id uuid);
create table public.property_media(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null);
grant usage on schema public to authenticated, service_role;
grant select on all tables in schema public to authenticated;
`;

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ADV = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";
const FULL = "portals:view portals:edit properties:view properties:edit";

describe.skipIf(!mod)("EİDS yetki defteri (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string, role: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false), set_config('test.role','${role}',false), set_config('test.authrole','authenticated',false)`);
    await db.exec(`set role authenticated`);
  };
  const apply = async (prop: string | null, ev: Record<string, unknown>, tenant = T) =>
    (await q(`select public.eids_apply_authority_event($1::uuid, $2::uuid, $3::jsonb) as r`, [tenant, prop, JSON.stringify(ev)]))[0]!.r as Record<string, unknown>;
  const undo = async (eventId: string) =>
    (await q(`select public.eids_undo_authority_event($1::uuid, $2::uuid, null) as r`, [T, eventId]))[0]!.r as Record<string, unknown>;
  const prop = async (id = P) => {
    await db.exec(`reset role`);
    return (await q(`select authority_eids_status as s, authorization_start::text as st, authorization_end::text as en, eids_property_no as no from public.properties where id = $1`, [id]))[0]!;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(`insert into public.tenants(id) values ('${T}'), ('${T2}');
      insert into public.properties(id, tenant_id, eids_property_no, authorization_start, authorization_end, authority_eids_status)
        values ('${P}', '${T}', null, '2026-08-01', '2026-11-01', 'pending'),
               ('${P2}', '${T}', 'EIDS-34-4410-0141', null, null, 'approved');`);
    await db.exec(read("supabase/migrations/20261013007100_eids_authority_ledger.sql"));
  });

  it("danışman kendi uid'iyle doğrudan override/undo satırı ekleyemez (tablo INSERT yetkisi yok)", async () => {
    await as(ADV, T, FULL, "advisor");
    await expect(
      db.exec(`insert into public.eids_authority_events(tenant_id, property_id, kind, source, actor_id, note)
        values ('${T}', '${P}', 'override', 'manual', '${ADV}', 'en az on karakterlik gerekçe')`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec(`insert into public.eids_authority_events(tenant_id, property_id, kind, source, actor_id, undo_of)
        values ('${T}', '${P}', 'undo', 'manual', '${ADV}', gen_random_uuid())`),
    ).rejects.toThrow(/permission denied/);
    await db.exec(`reset role; set role service_role`);
    await expect(
      db.exec(`insert into public.eids_authority_events(tenant_id, property_id, kind, source, note) values ('${T}', '${P}', 'override', 'system', 'en az on karakter')`),
    ).rejects.toThrow(/permission denied/);
  });

  it("override RPC'si yalnız owner; danışmana owner_only", async () => {
    await as(ADV, T, FULL, "advisor");
    expect((await apply(P, { kind: "override", source: "manual", note: "gerekçe gerekçe gerekçe" })).outcome).toBe("owner_only");
    await as(OWNER, T, FULL, "owner");
    expect((await apply(P, { kind: "override", source: "manual", note: "kısa" })).outcome).toBe("note_required");
  });

  it("kiracı ve izin denetimi (DEFINER içinde açık)", async () => {
    await as(ADV, T2, FULL, "advisor");
    expect((await apply(P, { kind: "manual_set", source: "manual", new_status: "approved" })).outcome).toBe("forbidden");
    await as(ADV, T, "portals:view portals:edit", "advisor");
    expect((await apply(P, { kind: "manual_set", source: "manual", new_status: "approved" })).outcome).toBe("forbidden");
    await as(ADV, T, "properties:edit portals:view", "advisor");
    expect((await apply(P, { kind: "manual_set", source: "manual", new_status: "approved" })).outcome).toBe("forbidden");
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('test.authrole','anon',false)`);
    expect((await apply(P, { kind: "manual_set", source: "manual", new_status: "approved" })).outcome).toBe("forbidden");
  });

  it("veriliş tarihi authorization_start'a yazılır; geri alma onu da döndürür", async () => {
    await as(ADV, T, FULL, "advisor");
    const r = await apply(P, {
      kind: "manual_set", source: "manual", new_status: "approved",
      valid_from: "2026-09-01", set_valid_from: true, valid_until: "2026-12-15", set_valid_until: true,
    });
    expect(r.outcome).toBe("applied");
    expect(await prop()).toMatchObject({ s: "approved", st: "2026-09-01", en: "2026-12-15" });
    await as(ADV, T, FULL, "advisor");
    const u = await undo(String(r.event_id));
    expect(u).toMatchObject({ outcome: "applied", new_status: "pending" });
    expect(await prop()).toMatchObject({ s: "pending", st: "2026-08-01", en: "2026-11-01" });
  });

  it("geri alma yalnız değişen alanları döndürür; defter dışı düzenlemeyi ezmez", async () => {
    await as(ADV, T, FULL, "advisor");
    // Yalnız durum değişir; bitiş tarihine dokunulmaz.
    const r = await apply(P, { kind: "revoke", source: "manual", new_status: "revoked" });
    expect(r.outcome).toBe("applied");
    // Olaydan sonra taşınmaz no portföy formundan girildi (olayın değiştirmediği alan) → geri alma onu korur.
    await db.exec(`reset role; update public.properties set eids_property_no = '12345678' where id = '${P}'`);
    await as(ADV, T, FULL, "advisor");
    expect((await undo(String(r.event_id))).outcome).toBe("applied");
    expect(await prop()).toMatchObject({ s: "pending", no: "12345678" });

    // Olayın değiştirdiği alan (bitiş) sonradan formdan değişti → changed_outside, hiçbir şey ezilmez.
    await as(ADV, T, FULL, "advisor");
    const r2 = await apply(P, { kind: "extend", source: "manual", valid_until: "2027-03-01", set_valid_until: true });
    await db.exec(`reset role; update public.properties set authorization_end = '2027-05-01' where id = '${P}'`);
    await as(ADV, T, FULL, "advisor");
    expect((await undo(String(r2.event_id))).outcome).toBe("changed_outside");
    expect(await prop()).toMatchObject({ en: "2027-05-01" });
  });

  it("override sonrası olay: yalnız owner, gate için geçerli satır yazılır", async () => {
    await as(OWNER, T, FULL, "owner");
    const r = await apply(P, { kind: "override", source: "manual", note: "malik telefonla teyit etti, belge yolda" });
    expect(r.outcome).toBe("applied");
    await db.exec(`reset role`);
    const rows = await q(`select kind, actor_id::text as a from public.eids_authority_events where id = $1`, [r.event_id]);
    expect(rows[0]).toMatchObject({ kind: "override", a: OWNER });
  });

  it("taşınmaz no rakam anahtarıyla birebir: ayraçlı kayıt bulunur", async () => {
    await as(ADV, T, FULL, "advisor");
    const hit = await q(`select id::text as id from public.eids_properties_by_no_key($1::uuid, $2)`, [T, "3444100141"]);
    expect(hit.map((h) => h.id)).toEqual([P2]);
    expect(await q(`select id from public.eids_properties_by_no_key($1::uuid, $2)`, [T2, "3444100141"])).toHaveLength(0);
    expect(await q(`select id from public.eids_properties_by_no_key($1::uuid, $2)`, [T, "34-44"])).toHaveLength(0);
  });

  it("defter yalnız eklenir", async () => {
    await db.exec(`reset role`);
    await expect(db.exec(`update public.eids_authority_events set note = 'x'`)).rejects.toThrow(/yalniz eklenir/);
    await expect(db.exec(`delete from public.eids_authority_events`)).rejects.toThrow(/yalniz eklenir/);
  });
});
