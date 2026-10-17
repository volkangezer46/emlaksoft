import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): PKG-3 migration'ları.
 *  - 20261027030000 app_shell_bootstrap: usage.active_branches = çağıranın ofisindeki AKTİF şube sayısı (INVOKER: RLS
 *    geçerli, başka ofisin şubesi sayılmaz); diğer alanlar korunur; geri alma alanı kaldırır.
 *  - 20261027030100 yayın kırpma: Broadcast okuma politikaları + tetikleyici yoksa HİÇBİR ŞEY yapmaz; varsa yalnız
 *    support_ticket_messages/attachments kalır; geri alma 19 tabloyu geri ekler; ikinci çalıştırma no-op (idempotent).
 */
const mod = await loadPglite();
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (sql: string) => sql.replace(/^set local lock_timeout.*$/gm, "");

const U1 = "11111111-1111-4111-8111-111111111111";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const SHELL_SCHEMA = `
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to authenticated;
grant usage on schema public to authenticated;
create table public.profiles(id uuid primary key, tenant_id uuid, role text, full_name text, is_active boolean);
create table public.tenants(id uuid primary key, name text, plan text, status text, brand_color text, created_at timestamptz,
  slug text, trial_ends_at timestamptz, sample_seeded_at timestamptz);
create table public.platform_staff(id uuid primary key, email text, full_name text, role text, is_active boolean);
create table public.tenant_role_permissions(tenant_id uuid, role text, module text, action text, allowed boolean);
create table public.user_permission_overrides(tenant_id uuid, user_id uuid, module text, actions text[], expires_at timestamptz);
create table public.tenant_modules(tenant_id uuid, module_key text, enabled boolean, locked_by_platform boolean);
create table public.user_module_prefs(user_id uuid, tenant_id uuid, module_key text, hidden boolean);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, deleted_at timestamptz, status text);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, deleted_at timestamptz);
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid, assigned_to uuid, status text, due_at timestamptz);
create table public.approval_requests(id uuid primary key default gen_random_uuid(), tenant_id uuid, status text, requested_by uuid);
create table public.branches(id uuid primary key default gen_random_uuid(), tenant_id uuid, is_active boolean);
create function public.current_tenant_id() returns uuid language sql stable as $$
  select tenant_id from public.profiles where id = auth.uid() $$;
alter table public.branches enable row level security;
-- Ofis sınırı: çağıran yalnız kendi ofisinin şubelerini görür (INVOKER sayımı bununla sınırlanır).
create policy b_tenant on public.branches for select to authenticated using (tenant_id = public.current_tenant_id());
grant select on all tables in schema public to authenticated;
-- 20261006000400 taslağı (sonraki dosyaların ön koşulu); gövdeyi 20261012001100 yeniden yazar.
create function public.app_shell_bootstrap() returns jsonb language sql stable as $$ select null::jsonb $$;
`;

describe.skipIf(!mod)("PKG-3 migration'ları (pglite)", () => {
  describe("20261027030000 app_shell_bootstrap active_branches", () => {
    let db: Db;
    const call = async () => {
      await db.exec("reset role");
      await db.query("select set_config('test.uid', $1, false)", [U1]);
      await db.exec("set role authenticated");
      const r = await db.query("select public.app_shell_bootstrap() as b");
      await db.exec("reset role");
      return r.rows[0]!.b as Record<string, Record<string, unknown>>;
    };

    beforeAll(async () => {
      db = new mod!.PGlite();
      await db.exec(SHELL_SCHEMA);
      await db.exec(`
        insert into public.tenants(id, name, plan, status) values ('${T1}', 'Ofis', 'office', 'active'), ('${T2}', 'Diğer', 'office', 'active');
        insert into public.profiles values ('${U1}', '${T1}', 'owner', 'Sahip', true);
        insert into public.branches(tenant_id, is_active) values ('${T1}', true), ('${T1}', true), ('${T1}', false), ('${T2}', true);
      `);
      await db.exec(strip(read("supabase/migrations/20261012001100_app_shell_platform_staff.sql")));
    });

    it("before: no active_branches (code falls back to getOfficeSize)", async () => {
      const b = await call();
      expect(b.usage).not.toHaveProperty("active_branches");
    });

    it("after: active branches of the caller's office only (RLS respected), seats unchanged", async () => {
      await db.exec(strip(read("supabase/migrations/20261027030000_app_shell_office_size.sql")));
      const b = await call();
      expect(b.usage).toMatchObject({ seats: 1, active_branches: 2, customers: 0, active_properties: 0 });
      expect(b.profile).toMatchObject({ id: U1, tenant_id: T1, role: "owner" });
      const sec = await db.query("select prosecdef from pg_proc where proname = 'app_shell_bootstrap'");
      expect(sec.rows[0]!.prosecdef).toBe(false);
      const anon = await db.query("select has_function_privilege('anon', 'public.app_shell_bootstrap()', 'EXECUTE') as x");
      expect(anon.rows[0]!.x).toBe(false);
    });

    it("rollback removes the field again", async () => {
      await db.exec(strip(read("supabase/rollbacks/20261027030000_app_shell_office_size.rollback.sql")));
      const b = await call();
      expect(b.usage).not.toHaveProperty("active_branches");
      expect(b.usage).toMatchObject({ seats: 1 });
    });
  });

  describe("20261027030100 realtime publication trim (ERTELENDİ: supabase/proposed; canlı Broadcast doğrulamasından sonra migrations/a taşınır)", () => {
    let db: Db;
    const TABLES = [
      "appointments", "cash_entries", "commissions", "customer_demands", "customers", "deals", "finance_open_items",
      "finance_parties", "fsbo_leads", "listing_control_events", "listing_pool_entries", "notifications", "offers",
      "portal_listings", "properties", "property_keys", "rent_charges", "rent_payments", "tasks",
      "support_ticket_attachments", "support_ticket_messages",
    ];
    const published = async () =>
      (await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1")).rows.map((r) => r.tablename);
    const MIG = () => strip(read("supabase/proposed/20261027030100_realtime_publication_trim_apply.sql"));

    beforeAll(async () => {
      db = new mod!.PGlite();
      await db.exec(TABLES.map((t) => `create table public.${t}(id int primary key);`).join("\n"));
      await db.exec(`create publication supabase_realtime for table ${TABLES.map((t) => `public.${t}`).join(", ")};`);
      await db.exec("create schema realtime; create table realtime.messages(id int, topic text); alter table realtime.messages enable row level security;");
    });

    it("no Broadcast trigger / read policies → nothing is dropped", async () => {
      await db.exec(MIG());
      expect((await published()).length).toBe(21);
      await db.exec("create function public.rt_emit_tenant_change() returns trigger language plpgsql as $$ begin return null; end $$;");
      await db.exec("create policy rt_tenant_topic_read on realtime.messages for select using (true);");
      await db.exec(MIG()); // tek politika: yine ertelenir
      expect((await published()).length).toBe(21);
    });

    it("with both policies → only the staff ticket tables stay; idempotent", async () => {
      await db.exec("create policy rt_inbox_topic_read on realtime.messages for select using (true);");
      await db.exec(MIG());
      expect(await published()).toEqual(["support_ticket_attachments", "support_ticket_messages"]);
      await db.exec(MIG());
      expect(await published()).toEqual(["support_ticket_attachments", "support_ticket_messages"]);
    });

    it("rollback re-adds the 19 page tables", async () => {
      await db.exec(strip(read("supabase/proposed/20261027030100_realtime_publication_trim_apply.rollback.sql")));
      expect((await published()).sort()).toEqual([...TABLES].sort());
    });
  });
});
