import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import {
  PLATFORM_ACTIONS,
  PLATFORM_MODULES,
  platformCan,
  type PlatformCustomRole,
  type PlatformRole,
} from "@/lib/platform-access";

/**
 * İŞLEVSEL SQL TESTİ (pglite): SN1 — 20261014021010_platform_staff_can_gates.
 * Kabul: (1) SQL platform_staff_can, TS `platformCan` ile tüm sabit rol × modül × eylem ve özel rol matrislerinde birebir aynı;
 * (2) özel role "billing onayla" verilen personel update_tenant_plan_subscription'ı çalıştırabilir, verilmeyen (yalnız görüntüle,
 * taban rolü billing olsa bile) çalıştıramaz; sabit rollerde sonuç aynı; (3) politikalar (platform_settings, platform_mrr_daily)
 * ve küçük kapılar matrise uyar; (4) canlı gövde yaması tek ifadeyi değiştirir, idempotenttir; rollback eski rol kapısına döner.
 * update_tenant_plan_subscription / convert_demo_request_to_tenant burada yalnız kapı bölümüyle taslaktır; kapı metni gerçek
 * migration'daki (20260825000300) ifadeyle aynıdır (aşağıdaki test kaynakta varlığını doğrular).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.auth_role', true), '') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_active boolean default true);
create table public.platform_staff(id uuid primary key default gen_random_uuid(), email text, full_name text,
  role text not null check (role in ('super_admin', 'ops', 'support', 'billing')), is_active boolean not null default true);
create function public.is_platform_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_staff s where s.id = auth.uid() and s.is_active) $$;
create function public.growth_flag_on(p_key text) returns boolean language sql stable as $$ select false $$;

create table public.platform_settings(key text primary key, value text, updated_by uuid, updated_at timestamptz not null default now());
alter table public.platform_settings enable row level security;
create policy platform_settings_super_admin on public.platform_settings
  for all
  using (exists (select 1 from public.platform_staff s where s.id = (select auth.uid()) and s.is_active and s.role = 'super_admin'))
  with check (exists (select 1 from public.platform_staff s where s.id = (select auth.uid()) and s.is_active and s.role = 'super_admin'));
create table public.platform_mrr_daily(day date not null, tenant_id uuid not null, mrr_try numeric(12,2) not null default 0, status text not null default 'active',
  primary key (day, tenant_id));
alter table public.platform_mrr_daily enable row level security;
create policy platform_mrr_daily_staff_select on public.platform_mrr_daily
  for select to authenticated
  using ((select public.is_platform_staff()) and exists (select 1 from public.platform_staff ps
    where ps.id = (select auth.uid()) and ps.is_active = true and ps.role in ('super_admin', 'ops', 'billing')));

-- Kapı bölümü gerçek gövdeyle aynı ifade (20260825000300); geri kalan iş taslakta yok.
create function public.update_tenant_plan_subscription(p_tenant_id uuid, p_actor_id uuid, p_plan text, p_status text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_actor_id is null or not exists (
    select 1
    from public.platform_staff ps
    where ps.id = p_actor_id
      and ps.is_active = true
      and ps.role in ('super_admin', 'billing')
  ) then
    raise exception 'Active billing staff required.' using errcode = '42501';
  end if;
  return jsonb_build_object('outcome', 'updated', 'plan', p_plan);
end;
$$;
create function public.convert_demo_request_to_tenant(p_demo_id uuid, p_owner_user_id uuid, p_actor_id uuid, p_slug_base text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_actor_id is null or not exists (
    select 1
    from public.platform_staff ps
    where ps.id = p_actor_id
      and ps.is_active = true
      and ps.role in ('super_admin', 'ops', 'support')
  ) then
    raise exception 'Active sales staff required.' using errcode = '42501';
  end if;
  return jsonb_build_object('outcome', 'converted');
end;
$$;
create function public.support_is_ticket_staff() returns boolean language sql stable as $$ select false $$;
create function public.support_actor_is_valid(p_actor_id uuid, p_actor_kind text, p_tenant_id uuid default null) returns boolean language sql stable as $$ select false $$;
create function public.pt_rules_is_operator() returns boolean language sql stable as $$ select false $$;
create function public.pt_rules_is_super_admin() returns boolean language sql stable as $$ select false $$;
create function public.growth_staff_super_admin() returns uuid language sql stable as $$ select null::uuid $$;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.platform_settings to authenticated;
grant select on public.platform_mrr_daily to authenticated;
grant select on public.platform_staff to authenticated;
`;

const DG1 = "supabase/migrations/20261014001300_platform_custom_roles_four_eyes.sql";
const SN1 = "supabase/migrations/20261014021010_platform_staff_can_gates.sql";
const SN1_ROLLBACK = "supabase/rollbacks/20261014021010_platform_staff_can_gates.rollback.sql";
const ROLES: PlatformRole[] = ["super_admin", "ops", "support", "billing"];

describe.skipIf(!mod)("SN1 platform_staff_can: SQL kapıları DG1 özel rol matrisine uyar (pglite)", () => {
  let db: Db;
  const staff: Record<string, string> = {};
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const fails = async (sql: string, params: unknown[] = []) => {
    try {
      await q(sql, params);
    } catch (e) {
      return (e as Error).message;
    }
    return null;
  };
  const asService = () => db.exec(`reset role; select set_config('test.auth_role','service_role',false), set_config('request.jwt.claim.sub','',false)`);
  const asStaff = async (id: string, jwt: Record<string, unknown> = {}) => {
    await db.exec(`reset role; select set_config('test.auth_role','authenticated',false), set_config('request.jwt.claim.sub','${id}',false),
      set_config('test.jwt','${JSON.stringify(jwt)}',false)`);
    await db.exec(`set role authenticated`);
  };
  const addStaff = async (key: string, role: PlatformRole, permissions?: Record<string, unknown>, active = true) => {
    await db.exec(`reset role`);
    let customId: string | null = null;
    if (permissions) {
      customId = (await q(`insert into public.platform_custom_roles(label, base_role, permissions) values ($1, $2, $3::jsonb) returning id`, [
        `Rol ${key}`, role, JSON.stringify(permissions),
      ]))[0]!.id as string;
    }
    staff[key] = (await q(`insert into public.platform_staff(role, is_active, custom_role_id) values ($1, $2, $3) returning id`, [role, active, customId]))[0]!.id as string;
    return { id: staff[key]!, customId };
  };
  const sqlCan = async (id: string, module: string, action: string) => {
    await db.exec(`reset role`);
    return one<boolean>(`public.platform_staff_can($1::uuid, $2, $3)`, [id, module, action]);
  };
  const planChange = async (actor: string) => {
    await asService();
    return fails(`select public.update_tenant_plan_subscription($1::uuid, $2::uuid, 'office', 'active')`, ["00000000-0000-4000-8000-000000000001", actor]);
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read(DG1));
    await db.exec(read(SN1));
    for (const r of ROLES) await addStaff(r, r);
    await addStaff("billingApprover", "support", { billing: ["approve"] });
    await addStaff("billingViewer", "billing", { billing: ["view"], tickets: ["write"] });
    await addStaff("billingWriter", "support", { billing: ["write"] });
    await addStaff("settingsAdmin", "ops", { sistem: ["approve"], reports: ["view"] });
    await addStaff("bogus", "ops", { unknown: ["approve"], sales: ["fly"], reports: "view" });
    await addStaff("inactiveBilling", "billing", undefined, false);
    await db.exec(`reset role`);
    await q(`insert into public.platform_settings(key, value) values ('k', 'v')`);
    await q(`insert into public.platform_mrr_daily(day, tenant_id) values ('2026-10-01', gen_random_uuid())`);
  }, 120_000);

  it("kapı ifadeleri gerçek migration gövdesinde var (yama hedefi taslakla aynı)", () => {
    const src = read("supabase/migrations/20260825000300_billing_plan_amount_integrity.sql");
    expect(src).toContain("and ps.role in ('super_admin', 'billing')");
    expect(src).toContain("and ps.role in ('super_admin', 'ops', 'support')");
  });

  it("sabit roller: SQL matrisi TS platformCan ile tüm modül × eylemde birebir aynı", async () => {
    for (const role of ROLES) {
      for (const m of PLATFORM_MODULES) {
        for (const a of PLATFORM_ACTIONS) {
          expect({ role, m, a, can: await sqlCan(staff[role]!, m, a) }).toEqual({ role, m, a, can: platformCan(role, m, a) });
        }
      }
    }
  });

  it("özel roller: SQL TS ile aynı (iç içe eylemler, dashboard, bilinmeyen modül/eylem yok sayılır)", async () => {
    const custom: Record<string, Record<string, unknown>> = {
      billingApprover: { billing: ["approve"] },
      billingViewer: { billing: ["view"], tickets: ["write"] },
      settingsAdmin: { sistem: ["approve"], reports: ["view"] },
      bogus: { unknown: ["approve"], sales: ["fly"], reports: "view" },
    };
    for (const [key, permissions] of Object.entries(custom)) {
      const subject = { role: "support" as PlatformRole, customRole: { id: key, label: key, baseRole: "support", permissions } as PlatformCustomRole };
      for (const m of PLATFORM_MODULES) {
        for (const a of PLATFORM_ACTIONS) {
          expect({ key, m, a, can: await sqlCan(staff[key]!, m, a) }).toEqual({ key, m, a, can: platformCan(subject, m, a) });
        }
      }
    }
    expect(await sqlCan(staff.billing!, "nope", "view")).toBe(false);
    expect(await sqlCan(staff.billing!, "billing", "delete")).toBe(false);
    expect(await sqlCan(staff.inactiveBilling!, "billing", "view")).toBe(false);
  });

  it("özel role 'billing onayla' verilen personel paket değişikliği RPC'sini çalıştırabilir, verilmeyen çalıştıramaz", async () => {
    expect(await planChange(staff.billingApprover!)).toBeNull();
    expect(await planChange(staff.billingWriter!)).toBeNull();
    expect(await planChange(staff.billingViewer!)).toBe("Active billing staff required.");
    expect(await planChange(staff.settingsAdmin!)).toBe("Active billing staff required.");
    // Sabit roller: eskisi gibi super_admin + billing.
    expect(await planChange(staff.super_admin!)).toBeNull();
    expect(await planChange(staff.billing!)).toBeNull();
    expect(await planChange(staff.ops!)).toBe("Active billing staff required.");
    expect(await planChange(staff.support!)).toBe("Active billing staff required.");
    expect(await planChange(staff.inactiveBilling!)).toBe("Active billing staff required.");
    // Demo dönüşümü: sales:write (sabit: super_admin, ops, support).
    await asService();
    const demo = (id: string) => fails(`select public.convert_demo_request_to_tenant(gen_random_uuid(), gen_random_uuid(), $1::uuid, 'x')`, [id]);
    for (const r of ["super_admin", "ops", "support"]) expect(await demo(staff[r]!)).toBeNull();
    expect(await demo(staff.billing!)).toBe("Active sales staff required.");
    expect(await demo(staff.billingApprover!)).toBe("Active sales staff required.");
  });

  it("küçük kapılar ve politikalar matrise uyar; sabit rollerde sonuç aynı", async () => {
    const gates = async (key: string) => {
      await asStaff(staff[key]!);
      const r = {
        ticketStaff: await one<boolean>(`public.support_is_ticket_staff()`),
        operator: await one<boolean>(`public.pt_rules_is_operator()`),
        superAdmin: await one<boolean>(`public.pt_rules_is_super_admin()`),
        growth: (await one<string | null>(`public.growth_staff_super_admin()`)) !== null,
        settings: (await q(`select key from public.platform_settings`)).length,
        mrr: (await q(`select day from public.platform_mrr_daily`)).length,
      };
      await db.exec(`reset role`);
      return { ...r, actor: await one<boolean>(`public.support_actor_is_valid($1::uuid, 'staff')`, [staff[key]]) };
    };
    expect(await gates("super_admin")).toEqual({ ticketStaff: true, operator: true, superAdmin: true, growth: true, settings: 1, mrr: 1, actor: true });
    expect(await gates("ops")).toEqual({ ticketStaff: true, operator: true, superAdmin: false, growth: false, settings: 0, mrr: 1, actor: true });
    expect(await gates("billing")).toEqual({ ticketStaff: true, operator: false, superAdmin: false, growth: false, settings: 0, mrr: 1, actor: true });
    expect(await gates("support")).toEqual({ ticketStaff: true, operator: false, superAdmin: false, growth: false, settings: 0, mrr: 0, actor: true });
    // Özel roller: taban rol değil matris.
    expect(await gates("settingsAdmin")).toEqual({ ticketStaff: false, operator: true, superAdmin: true, growth: false, settings: 1, mrr: 1, actor: false });
    expect(await gates("billingViewer")).toEqual({ ticketStaff: true, operator: false, superAdmin: false, growth: false, settings: 0, mrr: 0, actor: true });
    // Kimlik bürünmede portal kuralı kapısı kapalı (eski davranış).
    await asStaff(staff.super_admin!, { app_metadata: { impersonating: "true" } });
    expect(await one<boolean>(`public.pt_rules_is_operator()`)).toBe(false);
    await db.exec(`reset role`);
    // Oturumla çağrılan sürüm yalnız kendi kimliği; staff_id'li sürüm istemciye kapalı.
    await asStaff(staff.billingApprover!);
    expect(await one<boolean>(`public.platform_staff_can('billing', 'approve')`)).toBe(true);
    expect(await fails(`select public.platform_staff_can($1::uuid, 'billing', 'view')`, [staff.super_admin])).toMatch(/permission denied/);
    await db.exec(`reset role`);
  });

  it("yama idempotent; rollback rol adına bakan eski kapıya döner, yeniden uygulanabilir", async () => {
    await db.exec(`reset role`);
    await db.exec(read(SN1));
    const def = String(await one(`pg_get_functiondef('public.update_tenant_plan_subscription(uuid,uuid,text,text)'::regprocedure)`));
    expect(def.split("platform_staff_can(ps.id, 'billing', 'write')").length).toBe(2);
    expect(def).not.toContain("ps.role in");

    await db.exec(read(SN1_ROLLBACK));
    expect(await one(`to_regprocedure('public.platform_staff_can(uuid,text,text)')::text`)).toBeNull();
    expect(await planChange(staff.billingApprover!)).toBe("Active billing staff required.");
    expect(await planChange(staff.billing!)).toBeNull();
    await asStaff(staff.settingsAdmin!);
    expect((await q(`select key from public.platform_settings`)).length).toBe(0);

    await db.exec(`reset role`);
    await db.exec(read(SN1));
    expect(await planChange(staff.billingApprover!)).toBeNull();
    await asStaff(staff.settingsAdmin!);
    expect((await q(`select key from public.platform_settings`)).length).toBe(1);
    await db.exec(`reset role`);
  });
});
