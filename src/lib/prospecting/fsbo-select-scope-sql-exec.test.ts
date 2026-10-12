import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012002600 + 20261012002800 — fsbo_leads SELECT kapsamı (danışman başkasının kaydını göremez),
 * fsbo_find_existing (yalnız var/yok + sahip adı), fsbo_assign_lead / fsbo_archive_lead yetki + kapsam ve assigned_to/deleted_at
 * sütun UPDATE yetkisinin kalkması. Şema sadeleştirilmiş taklit; politikalar/fonksiyonlar GERÇEK migration dosyalarıdır.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('app.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(current_setting('app.role', true), '') $$;
create function public.has_effective_permission(text, text) returns boolean language sql stable as $$ select coalesce(current_setting('app.deny', true), '') <> 'on' $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text, is_active boolean not null default true);
create table public.fsbo_leads(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid, assigned_to uuid, created_by uuid,
  source text default 'manual', portal text not null default 'sahibinden', external_id text, url text, title text,
  transaction_type text default 'sale', property_type text, price numeric, currency text default 'TRY', rooms text, gross_m2 numeric, net_m2 numeric,
  province_id uuid, district_id uuid, location_text text, listed_at date, first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(), listing_status text default 'unknown', owner_name text, phone text, phone_hash text,
  status text not null default 'yeni', status_changed_at timestamptz default now(), lost_reason text, contact_attempts integer default 0,
  last_contact_at timestamptz, next_action_at timestamptz, last_activity_at timestamptz not null default now(), price_drop_count integer default 0,
  last_price_drop_pct numeric, last_price_drop_at timestamptz, relist_of uuid, customer_id uuid, property_id uuid, converted_at timestamptz,
  claim_expires_at timestamptz, is_sample boolean not null default false, pii_purged_at timestamptz, created_at timestamptz default now(),
  updated_at timestamptz default now(), deleted_at timestamptz);
create table public.fsbo_lead_observations(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, lead_id uuid not null, price numeric);
create table public.fsbo_lead_activities(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, lead_id uuid not null, note text);
alter table public.fsbo_leads enable row level security;
alter table public.fsbo_lead_observations enable row level security;
alter table public.fsbo_lead_activities enable row level security;
grant select, insert, update, delete on public.fsbo_leads to authenticated;
grant select, insert on public.fsbo_lead_observations to authenticated;
grant select, insert on public.fsbo_lead_activities to authenticated;
grant select on public.profiles to authenticated;
`;

describe.skipIf(!mod)("FSBO SELECT kapsamı + atama/arşiv RPC (pglite)", () => {
  let db: Db;
  let T: string, T2: string, A: string, B: string, M: string, CC: string, OUT: string;
  let LA: string, LB: string, LFREE: string, LCREATED: string, LIDLE: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  async function as<R>(uid: string, role: string, fn: () => Promise<R>, tenant = T, deny = false): Promise<R> {
    await db.exec(`select set_config('app.uid','${uid}',false), set_config('app.role','${role}',false), set_config('app.tenant','${tenant}',false), set_config('app.deny','${deny ? "on" : ""}',false)`);
    await db.exec("set role authenticated");
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
    }
  }
  const ids = async () => (await q(`select id from public.fsbo_leads order by title`)).map((r) => r.id as string);
  const lead = async (title: string, over: { assigned?: string | null; created?: string | null; ext?: string; idle?: boolean } = {}) =>
    (
      await q(
        `insert into public.fsbo_leads(tenant_id, title, assigned_to, created_by, portal, external_id, phone, phone_hash, owner_name, last_activity_at)
         values ($1,$2,$3,$4,'sahibinden',$5,'05321234567',$6,'Gizli Sahip', ${over.idle ? "now() - interval '20 days'" : "now()"}) returning id`,
        [T, title, over.assigned ?? null, over.created ?? null, over.ext ?? title, "h".repeat(64)],
      )
    )[0]!.id as string;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (t: string, name: string, active = true) => (await q(`insert into public.profiles(tenant_id, full_name, is_active) values ($1,$2,$3) returning id`, [t, name, active]))[0]!.id as string;
    A = await prof(T, "Ayşe Danışman");
    B = await prof(T, "Burak Danışman");
    M = await prof(T, "Mehmet Müdür");
    CC = await prof(T, "Cem Çağrı");
    OUT = await prof(T2, "Başka Ofis");
    LA = await lead("a-kayit", { assigned: A });
    LB = await lead("b-kayit", { assigned: B });
    LFREE = await lead("c-sahipsiz");
    LCREATED = await lead("d-benim-actigim", { assigned: B, created: A });
    LIDLE = await lead("e-hareketsiz", { assigned: B, idle: true });
    await q(`insert into public.fsbo_lead_activities(tenant_id, lead_id, note) values ($1,$2,'gizli not'), ($1,$3,'kendi notum')`, [T, LB, LA]);
    await q(`insert into public.fsbo_lead_observations(tenant_id, lead_id, price) values ($1,$2,100), ($1,$3,200)`, [T, LB, LA]);
    // Gerçek migration dosyaları (sırayla): 002600 UPDATE/INSERT politikası + sütun listesi, sonra 002800 SELECT kapsamı + RPC'ler.
    await db.exec(`create policy fsbo_leads_select_old on public.fsbo_leads for select to authenticated using (true)`);
    await db.exec(read("supabase/migrations/20261012002600_fsbo_rls_scope.sql"));
    await db.exec(`drop policy fsbo_leads_select_old on public.fsbo_leads`);
    await db.exec(read("supabase/migrations/20261012002800_fsbo_select_scope.sql"));
  });

  it("danışman başkasının kaydını göremez: kendi + sahipsiz + kendi oluşturduğu", async () => {
    const got = await as(A, "advisor", ids);
    expect(new Set(got)).toEqual(new Set([LA, LFREE, LCREATED]));
    expect(got).not.toContain(LB);
  });

  it("yönetici, takım lideri ve çağrı merkezi ofis genelini görür; başka kiracı hiçbir şey görmez", async () => {
    for (const [uid, role] of [[M, "owner"], [M, "team_lead"], [CC, "call_center"]] as const) {
      expect((await as(uid, role, ids)).length).toBe(5);
    }
    expect(await as(OUT, "owner", ids, T2)).toEqual([]);
  });

  it("görüntüleme izni yoksa hiçbir satır görünmez", async () => {
    expect(await as(M, "owner", ids, T, true)).toEqual([]);
  });

  it("başkasının kaydının zaman çizelgesi ve fiyat geçmişi de sızmaz", async () => {
    const notes = await as(A, "advisor", async () => (await q(`select note from public.fsbo_lead_activities`)).map((r) => r.note));
    expect(notes).toEqual(["kendi notum"]);
    const prices = await as(A, "advisor", async () => (await q(`select price::int as p from public.fsbo_lead_observations`)).map((r) => r.p));
    expect(prices).toEqual([200]);
  });

  it("fsbo_find_existing yalnız var/yok + sahip adı + sahiplik tarihleri döner (telefon, ilan sahibi adı, fiyat yok)", async () => {
    const rows = await as(A, "advisor", () => q(`select * from public.fsbo_find_existing($1)`, [sha("ext|sahibinden|b-kayit")]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lead_id: LB, match_kind: "url", assignee_name: "Burak Danışman", is_mine: false });
    expect(Object.keys(rows[0]!).sort()).toEqual(["assigned_to", "assignee_name", "claim_expires_at", "is_mine", "last_activity_at", "lead_id", "match_kind", "status"]);
    // Aynı numara: tekilleştirme (RLS'i delmeden).
    const byPhone = await as(A, "advisor", () => q(`select * from public.fsbo_find_existing($1, $2, $3)`, ["0".repeat(64), "z".repeat(64), "h".repeat(64)]));
    expect(byPhone.length).toBeGreaterThan(0);
    expect(byPhone.every((r) => r.match_kind === "phone")).toBe(true);
    // Başka kiracı ve izinsiz kullanıcı boş görür.
    expect(await as(OUT, "advisor", () => q(`select * from public.fsbo_find_existing($1)`, [sha("ext|sahibinden|b-kayit")]), T2)).toEqual([]);
    expect(await as(A, "advisor", () => q(`select * from public.fsbo_find_existing($1)`, [sha("ext|sahibinden|b-kayit")]), T, true)).toEqual([]);
  });

  it("atama: danışman başkasının aktif kaydını alamaz, sahipsiz ve hareketsiz kaydı kendine alabilir, başkasına atayamaz", async () => {
    const assign = (uid: string, role: string, lead: string, to: string) => as(uid, role, async () => (await q(`select public.fsbo_assign_lead($1,$2) as r`, [lead, to]))[0]!.r as string);
    expect(await assign(A, "advisor", LB, A)).toBe("denied");
    expect(await assign(A, "advisor", LFREE, B)).toBe("denied");
    expect(await assign(A, "advisor", LFREE, A)).toBe("ok");
    expect(await assign(A, "advisor", LIDLE, A)).toBe("ok");
    expect(await assign(A, "advisor", LB, OUT)).toBe("bad_target");
    expect(await assign(M, "owner", LB, OUT)).toBe("bad_target");
    expect(await assign(M, "team_lead", LB, A)).toBe("ok");
    expect(await assign(CC, "call_center", LA, CC)).toBe("denied");
    const none = await as(A, "advisor", async () => (await q(`select public.fsbo_assign_lead($1,$2) as r`, [LA, A]))[0]!.r, T, true);
    expect(none).toBe("denied");
  });

  it("assigned_to ve deleted_at için doğrudan UPDATE yetkisi yoktur; diğer sütunlar güncellenir", async () => {
    await expect(as(M, "owner", () => db.query(`update public.fsbo_leads set assigned_to = $1 where id = $2`, [M, LA]))).rejects.toThrow(/permission denied/i);
    await expect(as(M, "owner", () => db.query(`update public.fsbo_leads set deleted_at = now() where id = $1`, [LA]))).rejects.toThrow(/permission denied/i);
    await as(A, "advisor", () => db.query(`update public.fsbo_leads set title = 'a-kayit' where id = $1`, [LA]));
  });

  it("arşiv: danışman başkasının kaydını kaldıramaz; kendi/yönetici kaldırır; izinsiz kaldıramaz", async () => {
    const arch = (uid: string, role: string, lead: string, deny = false) => as(uid, role, async () => (await q(`select public.fsbo_archive_lead($1) as r`, [lead]))[0]!.r as string, T, deny);
    const other = await lead("f-baskasi", { assigned: B });
    expect(await arch(A, "advisor", other)).toBe("denied");
    expect(await arch(A, "advisor", LA, true)).toBe("denied");
    expect(await arch(A, "advisor", LA)).toBe("ok");
    expect(await arch(A, "advisor", LA)).toBe("not_found");
    expect(await arch(M, "owner", other)).toBe("ok");
  });
});
