import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261018010000 merge_customers v2 + merge_fk_refs + merge_preview_counts ve
 * 20261018010001 merge_properties. Küçük Supabase taklidi üzerinde: tüm FK'ler (bileşik FK, tenant_id'siz tablo,
 * iki sütunlu referans) taşınır, benzersiz anahtarda çakışan satır kopyada kalır, alan seçimi uygulanır, farklı
 * telefon/e-posta ve kopya notu ana kaydın notuna düşer, başka ofis reddedilir, medya kapağı korunur, rollback çalışır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text,
  phone text, email text, notes text, source text, birth_date date, anniversary_date date, anniversary_note text,
  province_id uuid, district_id uuid, branch_id uuid, assigned_to uuid, customer_types text[], tags text[],
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz, deleted_at timestamptz,
  unique (id, tenant_id));
create table public.calls(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  customer_id uuid references public.customers(id));
create table public.iys_consents(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  customer_id uuid references public.customers(id), channel text not null, unique (tenant_id, customer_id, channel));
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, renter_customer_id uuid,
  constraint rentals_renter_fk foreign key (renter_customer_id, tenant_id) references public.customers(id, tenant_id));
create table public.referrals(id uuid primary key default gen_random_uuid(),
  referrer_customer_id uuid references public.customers(id), created_customer_id uuid references public.customers(id));
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_code text not null,
  title text, address_line text, parcel_block text, parcel_lot text, province_id uuid, district_id uuid, neighborhood_id uuid,
  lat double precision, lng double precision, branch_id uuid, assigned_to uuid,
  owner_customer_id uuid references public.customers(id), features jsonb not null default '{}', status text default 'active',
  list_price numeric, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz, deleted_at timestamptz);
create table public.property_media(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  property_id uuid references public.properties(id), is_cover boolean not null default false, sort_order int not null default 0);
create table public.property_control_state(property_id uuid primary key references public.properties(id), tenant_id uuid not null);
create table public.share_links(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, entity_type text, entity_id uuid);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text,
  entity_type text, entity_id uuid, old_value jsonb, new_value jsonb);
`;

describe.skipIf(!mod)("kayıt birleştirme RPC'leri (pglite)", () => {
  let db: Db;
  const T = "00000000-0000-4000-8000-0000000000a1";
  const T2 = "00000000-0000-4000-8000-0000000000a2";
  const U = "00000000-0000-4000-8000-000000000001";
  const ADV2 = "00000000-0000-4000-8000-000000000002";
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;
  const as = (tenant: string, perms: string) =>
    db.exec(
      `select set_config('request.jwt.claim.sub','${U}',false), set_config('test.tenant','${tenant}',false), set_config('test.perms','${perms}',false)`,
    );
  const cust = async (tenant: string, fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    const cols = ["tenant_id", ...keys].join(", ");
    const vals = ["$1", ...keys.map((_, i) => `$${i + 2}`)].join(", ");
    return (await one(`insert into public.customers(${cols}) values (${vals}) returning id`, [tenant, ...Object.values(fields)])).id as string;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261018010000_merge_customers_v2.sql"));
    await db.exec(read("supabase/migrations/20261018010001_merge_properties.sql"));
  });

  it("müşteri: önizleme tüm FK'leri sayar; yetki ve ofis şart", async () => {
    const A = await cust(T, { full_name: "Ali Veli", phone: "05321111111" });
    const B = await cust(T, { full_name: "Ali Veli", phone: "05322222222" });
    await q(`insert into public.calls(tenant_id, customer_id) values ($1,$2),($1,$2)`, [T, B]);
    await q(`insert into public.rentals(tenant_id, renter_customer_id) values ($1,$2)`, [T, B]);
    await q(`insert into public.referrals(referrer_customer_id, created_customer_id) values ($1,$1)`, [B]);
    await as(T, "customers:view");
    await expect(q(`select public.merge_preview_counts('customers',$1,$2,$3::uuid[])`, [T, A, [B]])).rejects.toThrow(/yetkiniz/);
    await as(T2, "customers:delete");
    await expect(q(`select public.merge_preview_counts('customers',$1,$2,$3::uuid[])`, [T, A, [B]])).rejects.toThrow(/ofiste/);
    await as(T, "customers:delete");
    const r = (await one(`select public.merge_preview_counts('customers',$1,$2,$3::uuid[]) as r`, [T, A, [B]])).r as {
      moved: Record<string, number>;
    };
    expect(r.moved).toEqual({
      "calls.customer_id": 2,
      "referrals.created_customer_id": 1,
      "referrals.referrer_customer_id": 1,
      "rentals.renter_customer_id": 1,
    });
  });

  it("müşteri: tüm bağlı kayıtlar taşınır, çakışan İYS izni kopyada kalır, alan seçimi + farklı telefon/not korunur", async () => {
    const A = await cust(T, { full_name: "Ayşe Kaya", phone: "05330000001", email: "ayse@ornek.com", notes: "Ana not", tags: ["vip"] });
    const B = await cust(T, {
      full_name: "Ayşe K.", phone: "05330000002", email: "AYSE@ornek.com", notes: "Kopya not: bütçe 5M", tags: ["yatirimci"],
      source: "sahibinden", assigned_to: ADV2,
    });
    const P = (await one(`insert into public.properties(tenant_id, property_code, owner_customer_id) values ($1,'P-1',$2) returning id`, [T, B])).id;
    await q(`insert into public.calls(tenant_id, customer_id) values ($1,$2)`, [T, B]);
    await q(`insert into public.rentals(tenant_id, renter_customer_id) values ($1,$2)`, [T, B]);
    await q(`insert into public.iys_consents(tenant_id, customer_id, channel) values ($1,$2,'sms'),($1,$3,'sms'),($1,$3,'email')`, [T, A, B]);
    await q(`insert into public.share_links(tenant_id, entity_type, entity_id) values ($1,'customer',$2)`, [T, B]);

    const res = (await one(
      `select public.merge_customers($1,$2,$3::uuid[],$4,$5::jsonb) as r`,
      [T, A, [B], U, JSON.stringify({ phone: B, assigned_to: B })],
    )).r as { moved: Record<string, number>; kept: Record<string, number>; overridden: string[] };
    expect(res.moved["calls.customer_id"]).toBe(1);
    expect(res.moved["rentals.renter_customer_id"]).toBe(1);
    expect(res.moved["properties.owner_customer_id"]).toBe(1);
    expect(res.moved["iys_consents.customer_id"]).toBe(1);
    expect(res.moved["share_links.entity_id"]).toBe(1);
    expect(res.kept).toEqual({ "iys_consents.customer_id": 1 });
    expect(res.overridden.sort()).toEqual(["assigned_to", "phone"]);

    expect((await one(`select owner_customer_id from public.properties where id=$1`, [P])).owner_customer_id).toBe(A);
    const a = await one(`select phone, email, notes, source, assigned_to, tags from public.customers where id=$1`, [A]);
    expect(a.phone).toBe("05330000002");
    expect(a.email).toBe("ayse@ornek.com");
    expect(a.source).toBe("sahibinden");
    expect(a.assigned_to).toBe(ADV2);
    expect(a.tags).toEqual(["vip", "yatirimci"]);
    const notes = String(a.notes);
    expect(notes.startsWith("Ana not")).toBe(true);
    expect(notes).toContain("[birleştirme] ek telefon: 05330000001");
    expect(notes).not.toContain("ek e-posta"); // yalnız büyük/küçük harf farkı
    expect(notes).toContain("Kopya not: bütçe 5M");
    const b = await one(`select deleted_at, notes from public.customers where id=$1`, [B]);
    expect(b.deleted_at).not.toBeNull();
    expect(String(b.notes)).toContain("ile birleştirildi");
    const audit = await one(`select action, new_value from public.audit_logs where entity_id=$1`, [A]);
    expect(audit.action).toBe("customer.merge");
  });

  it("müşteri: başka ofisin kaydı ve listede olmayan kaynak reddedilir; hiçbir şey değişmez", async () => {
    const A = await cust(T, { full_name: "X" });
    const OTHER = await cust(T2, { full_name: "Y" });
    await expect(q(`select public.merge_customers($1,$2,$3::uuid[],$4)`, [T, A, [OTHER], U])).rejects.toThrow(/bu ofise ait değil/);
    const B = await cust(T, { full_name: "Z" });
    await expect(
      q(`select public.merge_customers($1,$2,$3::uuid[],$4,$5::jsonb)`, [T, A, [B], U, JSON.stringify({ phone: OTHER })]),
    ).rejects.toThrow(/birleştirilen kayıtlardan/);
    await expect(
      q(`select public.merge_customers($1,$2,$3::uuid[],$4,$5::jsonb)`, [T, A, [B], U, JSON.stringify({ notes: B })]),
    ).rejects.toThrow(/seçilemez/);
    expect((await one(`select deleted_at from public.customers where id=$1`, [B])).deleted_at).toBeNull();
  });

  it("portföy: medya kapağı korunur, benzersiz kontrol durumu kopyada kalır, boş konum dolar, yetki şart", async () => {
    const P1 = (await one(`insert into public.properties(tenant_id, property_code, title, features) values ($1,'K-1','Daire','{"oda":"3+1"}') returning id`, [T])).id as string;
    const P2 = (await one(
      `insert into public.properties(tenant_id, property_code, title, lat, lng, features) values ($1,'K-2','Bahçeli daire',41.0,29.0,'{"oda":"2+1","asansor":true}') returning id`,
      [T],
    )).id as string;
    await q(`insert into public.property_media(tenant_id, property_id, is_cover, sort_order) values ($1,$2,true,0),($1,$3,true,0),($1,$3,false,1)`, [T, P1, P2]);
    await q(`insert into public.property_control_state(property_id, tenant_id) values ($1,$2),($3,$2)`, [P1, T, P2]);
    await q(`insert into public.share_links(tenant_id, entity_type, entity_id) values ($1,'property',$2)`, [T, P2]);

    await as(T, "properties:edit");
    await expect(q(`select public.merge_properties($1,$2,$3::uuid[])`, [T, P1, [P2]])).rejects.toThrow(/yetkiniz/);
    await as(T, "properties:delete");
    const prev = (await one(`select public.merge_preview_counts('properties',$1,$2,$3::uuid[]) as r`, [T, P1, [P2]])).r as {
      moved: Record<string, number>;
    };
    expect(prev.moved["property_media.property_id"]).toBe(2);

    const r = (await one(`select public.merge_properties($1,$2,$3::uuid[],$4::jsonb) as r`, [T, P1, [P2], JSON.stringify({ title: P2 })])).r as {
      moved: Record<string, number>;
      kept: Record<string, number>;
    };
    expect(r.moved["property_media.property_id"]).toBe(2);
    expect(r.moved["share_links.entity_id"]).toBe(1);
    expect(r.kept).toEqual({ "property_control_state.property_id": 1 });
    const covers = await q(`select is_cover, sort_order from public.property_media where property_id=$1 order by sort_order`, [P1]);
    expect(covers.filter((c) => c.is_cover).length).toBe(1);
    expect(covers.map((c) => c.sort_order)).toEqual([0, 1, 2]);
    const p = await one(`select title, lat, features from public.properties where id=$1`, [P1]);
    expect(p.title).toBe("Bahçeli daire");
    expect(p.lat).toBe(41);
    expect(p.features).toEqual({ oda: "3+1", asansor: true });
    expect((await one(`select deleted_at from public.properties where id=$1`, [P2])).deleted_at).not.toBeNull();

    await as(T2, "properties:delete");
    await expect(q(`select public.merge_properties($1,$2,$3::uuid[])`, [T, P1, [P2]])).rejects.toThrow(/ofiste/);
  });

  it("rollback: v1 (4 argüman) geri gelir, yeni fonksiyonlar düşer", async () => {
    await db.exec(read("supabase/rollbacks/20261018010001_merge_properties.rollback.sql"));
    await db.exec(read("supabase/rollbacks/20261018010000_merge_customers_v2.rollback.sql"));
    const fns = await q(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname in ('merge_customers','merge_properties','merge_fk_refs','merge_preview_counts')`,
    );
    expect(fns).toEqual([{ proname: "merge_customers", args: "p_tenant_id uuid, p_primary uuid, p_duplicates uuid[], p_actor uuid" }]);
  });
});
