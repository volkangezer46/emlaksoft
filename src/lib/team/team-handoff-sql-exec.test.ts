import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { CLOSED_APPOINTMENT_STATUSES, CLOSED_DEAL_STAGES } from "@/lib/workflow-state";
import { OPEN_STATUSES as FSBO_OPEN_STATUSES } from "@/lib/prospecting/types";
import { HANDOFF_PERMISSION, HANDOFF_SCOPES } from "@/lib/team/handoff";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261016120100 team_handoff_workload — tüm kapsamlar tek transaction'da taşınır,
 * süzgeçler eylem katmanıyla aynı (kapalı anlaşma/geçmiş randevu/kapalı görev/kapalı aday kalır), havuz ataması
 * devralana geçer, audit satırı yazılır; yetki/kiracı/sahip kapıları; hata olursa hiçbir şey değişmez; rollback temiz.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIG = "supabase/migrations/20261016120100_team_handoff_workload.sql";
const RB = "supabase/rollbacks/20261016120100_team_handoff_workload.rollback.sql";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text not null default 'X',
  role text not null default 'advisor', is_active boolean not null default true);
create function public.current_active_tenant_id() returns uuid language sql stable as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid() and p.is_active $$;
create function public.current_profile_role() returns text language sql stable as $$
  select p.role from public.profiles p where p.id = auth.uid() $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select not (p_module || ':' || p_action = any(string_to_array(coalesce(current_setting('test.deny', true), ''), ','))) $$;
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid, deleted_at timestamptz);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid,
  deleted_at timestamptz, updated_at timestamptz);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid,
  stage text not null default 'new', updated_at timestamptz);
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid, status text not null default 'open');
create table public.appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid,
  status text not null default 'pending', scheduled_at timestamptz not null default now() + interval '1 day');
create table public.fsbo_leads(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid,
  status text not null default 'yeni', deleted_at timestamptz);
create table public.listing_pool_entries(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  status text not null default 'assigned', assigned_to uuid);
create table public.listing_pool_events(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, entry_id uuid not null,
  event text not null, actor_id uuid, from_profile_id uuid, to_profile_id uuid, reason text, detail jsonb not null default '{}');
create table public.pool_assignments(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  from_pool_id uuid, assigned_to uuid not null, previous_assignee uuid, assigned_by uuid, method text not null,
  score jsonb not null default '{}', reason text, status text not null default 'active');
create unique index uq_pool_assignments_active_per_property on public.pool_assignments (property_id) where status = 'active';
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text not null,
  entity_type text, entity_id uuid, old_value jsonb, new_value jsonb);
`;

const ALL = [...HANDOFF_SCOPES];

describe.skipIf(!mod)("team_handoff_workload (pglite)", () => {
  let db: Db;
  let T: string, T2: string, OWNER: string, MGR: string, FROM: string, TO: string, PASSIVE: string, OTHER_T: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const as = async (uid: string, deny = "") => db.exec(`set test.uid = '${uid}'; set test.deny = '${deny}'`);
  const run = (from: string, to: string, scopes: string[], reason = "Ekipten ayrıldı") =>
    q(`select public.team_handoff_workload($1, $2, $3::text[], $4) as r`, [from, to, scopes, reason]).then(
      (r) => r[0]!.r as { counts: Record<string, number>; ids: Record<string, string[]> },
    );
  const owners = async (table: string) =>
    (await q(`select assigned_to, count(*)::int as n from public.${table} group by 1`)).reduce<Record<string, number>>(
      (acc, r) => ({ ...acc, [String(r.assigned_to)]: Number(r.n) }),
      {},
    );

  const seed = async () => {
    await db.exec(`truncate public.customers, public.properties, public.deals, public.tasks, public.appointments, public.fsbo_leads,
      public.listing_pool_entries, public.listing_pool_events, public.pool_assignments, public.audit_logs`);
    const ins = (sql: string, p: unknown[]) => q(sql, p);
    await ins(`insert into public.customers(tenant_id, assigned_to, deleted_at) values ($1,$2,null),($1,$2,null),($1,$2,now()),($3,$2,null)`, [T, FROM, T2]);
    const props = await ins(`insert into public.properties(tenant_id, assigned_to) values ($1,$2),($1,$2) returning id`, [T, FROM]);
    await ins(`insert into public.properties(tenant_id, assigned_to, deleted_at) values ($1,$2,now())`, [T, FROM]);
    const p1 = props[0]!.id as string;
    const entry = await ins(`insert into public.listing_pool_entries(tenant_id, property_id, assigned_to) values ($1,$2,$3) returning id`, [T, p1, FROM]);
    await ins(`insert into public.pool_assignments(tenant_id, property_id, from_pool_id, assigned_to, method) values ($1,$2,$3,$4,'smart')`, [T, p1, entry[0]!.id, FROM]);
    for (const stage of ["new", "negotiation", ...CLOSED_DEAL_STAGES]) await ins(`insert into public.deals(tenant_id, assigned_to, stage) values ($1,$2,$3)`, [T, FROM, stage]);
    await ins(`insert into public.tasks(tenant_id, assigned_to, status) values ($1,$2,'open'),($1,$2,'done')`, [T, FROM]);
    await ins(`insert into public.appointments(tenant_id, assigned_to, status) values ($1,$2,'pending'),($1,$2,'signature')`, [T, FROM]);
    for (const s of CLOSED_APPOINTMENT_STATUSES) await ins(`insert into public.appointments(tenant_id, assigned_to, status) values ($1,$2,$3)`, [T, FROM, s]);
    await ins(`insert into public.appointments(tenant_id, assigned_to, status, scheduled_at) values ($1,$2,'pending', now() - interval '1 day')`, [T, FROM]);
    for (const s of [...FSBO_OPEN_STATUSES, "kayip", "portfoye_donustu"]) await ins(`insert into public.fsbo_leads(tenant_id, assigned_to, status) values ($1,$2,$3)`, [T, FROM, s]);
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (tenant: string, role = "advisor", active = true) =>
      (await q(`insert into public.profiles(tenant_id, role, is_active, full_name) values ($1,$2,$3,$2) returning id`, [tenant, role, active]))[0]!.id as string;
    OWNER = await prof(T, "owner");
    MGR = await prof(T, "branch_manager");
    FROM = await prof(T);
    TO = await prof(T);
    PASSIVE = await prof(T, "advisor", false);
    OTHER_T = await prof(T2);
  });

  it("taban yoksa açık hata verir", async () => {
    const other = new mod!.PGlite();
    await expect(other.exec(read(MIG))).rejects.toThrow(/public\.profiles yok/);
  });

  it("migration iki kez uygulanabilir; SQL süzgeçleri TS sabitleriyle aynı", async () => {
    await db.exec(read(MIG));
    await db.exec(read(MIG));
    const sql = read(MIG);
    expect(sql).toContain(`stage::text not in (${CLOSED_DEAL_STAGES.map((s) => `'${s}'`).join(", ")})`);
    expect(sql).toContain(`status::text not in (${CLOSED_APPOINTMENT_STATUSES.map((s) => `'${s}'`).join(", ")})`);
    expect(sql).toContain(`status in (${FSBO_OPEN_STATUSES.map((s) => `'${s}'`).join(", ")})`);
    for (const s of HANDOFF_SCOPES) expect(sql).toContain(`when '${s}' then '${HANDOFF_PERMISSION[s]}'`);
    expect(sql).not.toMatch(/^notify pgrst/m);
  });

  beforeEach(async () => {
    await seed();
  });

  it("tüm kapsamları tek seferde taşır, kapalı/geçmiş kayıtlar kalır, havuz ataması ve audit yazılır", async () => {
    await as(MGR);
    const r = await run(FROM, TO, ALL);
    expect(r.counts).toEqual({ customers: 2, properties: 2, deals: 2, tasks: 1, appointments: 2, fsbo_leads: 4, listing_pool: 1 });
    expect(await owners("customers")).toEqual({ [TO]: 2, [FROM]: 2 }); // silinmiş + diğer kiracı kalır
    expect(await owners("deals")).toEqual({ [TO]: 2, [FROM]: 2 });
    expect(await owners("tasks")).toEqual({ [TO]: 1, [FROM]: 1 });
    expect(await owners("appointments")).toEqual({ [TO]: 2, [FROM]: 3 });
    expect(await owners("fsbo_leads")).toEqual({ [TO]: 4, [FROM]: 2 });
    expect(await owners("listing_pool_entries")).toEqual({ [TO]: 1 });
    const pa = await q(`select assigned_to, status, previous_assignee, method from public.pool_assignments order by status`);
    expect(pa).toEqual([
      { assigned_to: TO, status: "active", previous_assignee: FROM, method: "manual" },
      { assigned_to: FROM, status: "reassigned", previous_assignee: null, method: "smart" },
    ]);
    expect((await q(`select event, from_profile_id, to_profile_id from public.listing_pool_events`))).toEqual([
      { event: "reassigned", from_profile_id: FROM, to_profile_id: TO },
    ]);
    const audit = await q(`select tenant_id, actor_id, action, entity_id, new_value from public.audit_logs`);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tenant_id: T, actor_id: MGR, action: "team.handoff", entity_id: FROM });
    expect((audit[0]!.new_value as Record<string, unknown>).customers).toBe(2);
  });

  it("yalnız seçilen kapsam taşınır", async () => {
    await as(MGR);
    const r = await run(FROM, TO, ["tasks"]);
    expect(r.counts.tasks).toBe(1);
    expect(r.counts.customers).toBe(0);
    expect(await owners("customers")).toEqual({ [FROM]: 4 });
  });

  it("yetki: team:edit ya da kapsam modülü edit yoksa reddedilir ve hiçbir şey değişmez", async () => {
    await as(MGR, "team:edit");
    await expect(run(FROM, TO, ["customers"])).rejects.toThrow(/ekip düzenleme yetkisi/);
    await as(MGR, "prospecting:edit");
    await expect(run(FROM, TO, ["customers", "fsbo_leads"])).rejects.toThrow(/düzenleme yetkisi/);
    expect(await owners("customers")).toEqual({ [FROM]: 4 });
    expect((await q(`select count(*)::int as n from public.audit_logs`))[0]!.n).toBe(0);
  });

  it("kiracı, devralan ve sahip kapıları", async () => {
    await as(MGR);
    await expect(run(FROM, OTHER_T, ["customers"])).rejects.toThrow(/Devralan danışman bulunamadı/);
    await expect(run(OTHER_T, TO, ["customers"])).rejects.toThrow(/bu ofiste bulunamadı/);
    await expect(run(FROM, PASSIVE, ["customers"])).rejects.toThrow(/pasif/);
    await expect(run(OWNER, TO, ["customers"])).rejects.toThrow(/yalnız ofis sahibi/);
    await expect(run(FROM, FROM, ["customers"])).rejects.toThrow(/aynı danışmana/);
    await expect(run(FROM, TO, ["customers"], "ab")).rejects.toThrow(/gerekçesi/);
    await expect(run(FROM, TO, [])).rejects.toThrow(/en az bir kapsam/);
    await expect(run(FROM, TO, ["kasalar"])).rejects.toThrow(/Geçersiz devir kapsamı/);
    await as(OTHER_T);
    await expect(run(FROM, TO, ["customers"])).rejects.toThrow(/Devralan danışman bulunamadı/);
    await db.exec(`set test.uid = ''`);
    await expect(run(FROM, TO, ["customers"])).rejects.toThrow(/Oturum gerekli/);
    await as(OWNER);
    expect((await run(OWNER, TO, ["customers"])).counts.customers).toBe(0);
  });

  it("adım hatası tüm devri geri alır (tek transaction)", async () => {
    await db.exec(`create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$;
      create trigger trg_boom before update on public.fsbo_leads for each row execute function public.boom();`);
    await as(MGR);
    await expect(run(FROM, TO, ALL)).rejects.toThrow(/boom/);
    expect(await owners("customers")).toEqual({ [FROM]: 4 });
    expect(await owners("properties")).toEqual({ [FROM]: 3 });
    expect((await q(`select count(*)::int as n from public.pool_assignments`))[0]!.n).toBe(1);
    await db.exec(`drop trigger trg_boom on public.fsbo_leads`);
  });

  it("isteğe bağlı tablolar yoksa ilgili adım atlanır", async () => {
    await db.exec(`alter table public.fsbo_leads rename to fsbo_leads_x; alter table public.pool_assignments rename to pool_assignments_x`);
    await as(MGR);
    const r = await run(FROM, TO, ALL);
    expect(r.counts.fsbo_leads).toBe(0);
    expect(r.counts.listing_pool).toBe(1);
    await db.exec(`alter table public.fsbo_leads_x rename to fsbo_leads; alter table public.pool_assignments_x rename to pool_assignments`);
  });

  it("rollback fonksiyonu kaldırır", async () => {
    await db.exec(read(RB).replace(/^notify .*$/m, ""));
    expect((await q(`select 1 from pg_proc where proname = 'team_handoff_workload'`)).length).toBe(0);
  });
});
