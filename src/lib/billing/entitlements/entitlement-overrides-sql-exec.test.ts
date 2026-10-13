import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ: 20261013004000 (ofise özel limit istisnası). Kapasite tetikleyicilerinin CANLI tabanı
 * (20260825000600 gövdeleri, md5 ön koşulu dahil) ve effective_seat_limit (20260825000500) önce yüklenir, sonra
 * migration DOSYASI OLDUĞU GİBİ çalıştırılır; gerçek PL/pgSQL (pglite) ile davranış doğrulanır. Modül yoksa ATLANIR.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create function public.is_platform_staff() returns boolean language sql stable as $$ select false $$;
create table public.platform_staff(id uuid primary key default gen_random_uuid(), role text not null default 'billing', is_active boolean not null default true);
create table public.tenants(id uuid primary key default gen_random_uuid(), plan text not null default 'office', status text not null default 'active', updated_at timestamptz);
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), is_active boolean not null default true);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), deleted_at timestamptz);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), deleted_at timestamptz, status text not null default 'live');
create table public.branches(id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), is_active boolean not null default true);
create table public.subscriptions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null unique references public.tenants(id), plan text not null default 'office', extra_seats integer not null default 0);
create table public.invoices(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id));
create table public.plan_entitlements(plan text primary key, seat_limit int, customer_limit int, active_property_limit int, branch_limit int);
insert into public.plan_entitlements values ('advisor',1,50,20,1),('office',3,5,null,2),('professional',6,null,null,null);
`;

/** Bir dosyadan `create or replace function public.<ad>()` ... `$$;` gövdesini (bitişiyle) çıkarır. */
function fnSql(file: string, name: string): string {
  const sql = read(file);
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error(`${name} bulunamadı: ${file}`);
  return sql.slice(start, end + 4);
}

const TRIGGERS = `
create trigger trg_profiles_plan_capacity before insert or update on public.profiles for each row execute function public.enforce_plan_capacity();
create trigger trg_customers_plan_capacity before insert or update on public.customers for each row execute function public.enforce_plan_capacity();
create trigger trg_properties_plan_capacity before insert or update on public.properties for each row execute function public.enforce_plan_capacity();
create trigger trg_branches_plan_capacity before insert or update on public.branches for each row execute function public.enforce_plan_capacity();
create trigger trg_tenants_plan_capacity before update on public.tenants for each row execute function public.enforce_tenant_plan_capacity();
`;

describe.skipIf(!mod)("ofise özel limit istisnası — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const tryQ = async (sql: string, params?: unknown[]): Promise<string | null> => {
    try {
      await q(sql, params);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  let staff: string;

  async function office(plan = "office", extraSeats = 0) {
    const t = (await q(`insert into public.tenants(plan) values ($1) returning id`, [plan]))[0]!.id as string;
    await q(`insert into public.subscriptions(tenant_id, plan, extra_seats) values ($1,$2,$3)`, [t, plan, extraSeats]);
    return t;
  }
  const addUser = (t: string) => tryQ(`insert into public.profiles(tenant_id) values ($1)`, [t]);
  const seatLimit = async (t: string) => (await q(`select public.effective_seat_limit($1) as n`, [t]))[0]!.n as number | null;
  const grant = (t: string, key: string, delta: number | null, value: number | null, expiresSql = "null") =>
    q(
      `insert into public.tenant_entitlement_overrides(tenant_id, key, delta, value, expires_at, reason, created_by)
       values ($1,$2,$3,$4,${expiresSql},'Kampanya anlaşması gereği istisna',$5) returning id`,
      [t, key, delta, value, staff],
    ).then((r) => r[0]!.id as string);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    // Canlı taban: 20260825000500 effective_seat_limit + 20260825000600 kapasite tetikleyicileri (md5 ön koşulu bunu arar).
    await db.exec(fnSql("supabase/migrations/20260825000500_billing_pause_proration_business_seats.sql", "effective_seat_limit"));
    await db.exec(fnSql("supabase/migrations/20260825000600_seat_purchase_fulfillment.sql", "enforce_plan_capacity"));
    await db.exec(fnSql("supabase/migrations/20260825000600_seat_purchase_fulfillment.sql", "enforce_tenant_plan_capacity"));
    await db.exec(TRIGGERS);
    await db.exec(read("supabase/migrations/20261013004000_subscription_ops_entitlement_overrides.sql"));
    staff = (await q(`insert into public.platform_staff default values returning id`))[0]!.id as string;
  }, 90_000);

  it("+5 koltuk istisnası: kullanıcı ekleme limiti 5 artar, bitiş tarihinde eski hâline döner", async () => {
    const t = await office();
    for (let i = 0; i < 3; i++) expect(await addUser(t)).toBeNull();
    expect(await addUser(t)).toContain("PLAN_LIMIT_EXCEEDED:seats:3");

    const id = await grant(t, "seats", 5, null, "now() + interval '7 days'");
    expect(await seatLimit(t)).toBe(8);
    for (let i = 0; i < 5; i++) expect(await addUser(t)).toBeNull();
    expect(await addUser(t)).toContain("PLAN_LIMIT_EXCEEDED:seats:8");

    // Bitiş geçmişe alınır (oluşturma da geriye; CHECK expires_at > created_at): limit plana döner.
    await q(`update public.tenant_entitlement_overrides set created_at = now() - interval '10 days', expires_at = now() - interval '1 second' where id = $1`, [id]);
    expect(await seatLimit(t)).toBe(3);
    // Mevcut 8 kullanıcı silinmez; yalnız yeni ekleme (ya da pasiften aktife alma) reddedilir.
    expect(await addUser(t)).toContain("PLAN_LIMIT_EXCEEDED:seats:3");
    const passive = (await q(`insert into public.profiles(tenant_id, is_active) values ($1,false) returning id`, [t]))[0]!.id;
    expect(await tryQ(`update public.profiles set is_active = true where id = $1`, [passive])).toContain("PLAN_LIMIT_EXCEEDED:seats:3");
  });

  it("satın alınmış ek kullanıcı istisnanın üstüne eklenir; geri alınan istisna sayılmaz", async () => {
    const t = await office("office", 2);
    expect(await seatLimit(t)).toBe(5);
    const id = await grant(t, "seats", 4, null);
    expect(await seatLimit(t)).toBe(9);
    await q(`update public.tenant_entitlement_overrides set revoked_at = now(), revoked_by = $2 where id = $1`, [id, staff]);
    expect(await seatLimit(t)).toBe(5);
  });

  it("müşteri/portföy/şube: sabit değer ve artış; sınırsız limit sınırsız kalır", async () => {
    const t = await office();
    for (let i = 0; i < 5; i++) expect(await tryQ(`insert into public.customers(tenant_id) values ($1)`, [t])).toBeNull();
    expect(await tryQ(`insert into public.customers(tenant_id) values ($1)`, [t])).toContain("PLAN_LIMIT_EXCEEDED:customers:5");
    await grant(t, "customers", null, 6);
    expect(await tryQ(`insert into public.customers(tenant_id) values ($1)`, [t])).toBeNull();
    expect(await tryQ(`insert into public.customers(tenant_id) values ($1)`, [t])).toContain("PLAN_LIMIT_EXCEEDED:customers:6");
    await grant(t, "customers", 1, null);
    expect(await tryQ(`insert into public.customers(tenant_id) values ($1)`, [t])).toBeNull();

    // Portföy limiti office'te sınırsız (null): istisna sınır koymaz.
    await grant(t, "active_properties", null, 1);
    for (let i = 0; i < 3; i++) expect(await tryQ(`insert into public.properties(tenant_id) values ($1)`, [t])).toBeNull();
    expect((await q(`select public.tenant_entitlement_resolve($1,'active_properties',null) as n`, [t]))[0]!.n).toBeNull();

    await grant(t, "branches", 1, null);
    for (let i = 0; i < 3; i++) expect(await tryQ(`insert into public.branches(tenant_id) values ($1)`, [t])).toBeNull();
    expect(await tryQ(`insert into public.branches(tenant_id) values ($1)`, [t])).toContain("PLAN_LIMIT_EXCEEDED:branches:3");
  });

  it("plan düşürme: yeni planın limiti istisnayla değerlendirilir", async () => {
    const t = await office("office");
    for (let i = 0; i < 2; i++) expect(await addUser(t)).toBeNull();
    // advisor: 1 koltuk → 2 aktif kullanıcıyla düşürme reddedilir.
    expect(await tryQ(`update public.tenants set plan = 'advisor' where id = $1`, [t])).toContain("PLAN_LIMIT_EXCEEDED:seats:1");
    await grant(t, "seats", 1, null);
    expect(await tryQ(`update public.tenants set plan = 'advisor' where id = $1`, [t])).toBeNull();
    expect(await seatLimit(t)).toBe(2);
  });

  it("şema kuralları: tam olarak bir tür, kısa gerekçe reddi, yalnız service_role yazar", async () => {
    const t = await office();
    expect(await tryQ(`insert into public.tenant_entitlement_overrides(tenant_id, key, delta, value, reason) values ($1,'seats',1,2,'Yeterince uzun gerekçe')`, [t])).not.toBeNull();
    expect(await tryQ(`insert into public.tenant_entitlement_overrides(tenant_id, key, delta, reason) values ($1,'seats',1,'kısa')`, [t])).not.toBeNull();
    expect(await tryQ(`insert into public.tenant_entitlement_overrides(tenant_id, key, delta, reason) values ($1,'gizli',1,'Yeterince uzun gerekçe')`, [t])).not.toBeNull();
    const priv = await q(
      `select has_table_privilege('authenticated','public.tenant_entitlement_overrides','insert') as ai,
              has_table_privilege('service_role','public.tenant_entitlement_overrides','insert') as si,
              has_table_privilege('service_role','public.tenant_entitlement_overrides','delete') as sd,
              has_function_privilege('anon','public.tenant_entitlement_resolve(uuid,text,integer)','execute') as ae`,
    );
    expect(priv[0]).toEqual({ ai: false, si: true, sd: false, ae: false });
  });

  it("migration tekrar çalıştırılabilir (işaretli gövde ön koşulu geçer)", async () => {
    await db.exec(read("supabase/migrations/20261013004000_subscription_ops_entitlement_overrides.sql"));
    const src = (await q(`select prosrc from pg_proc where proname = 'enforce_plan_capacity'`))[0]!.prosrc as string;
    expect(src).toContain("entitlement-override:v1");
  });
});
