import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Faz 2 migration sözleşmesi (docs/design/FAZ2_MIGRATIONS.md). Dosyalar statik doğrulanır; DB'ye dokunulmaz.

const NAMES = [
  "20260816000100_earnings_all_permission_defaults",
  "20260816000200_commission_splits",
  "20260816000300_advisor_commission_plans",
  "20260816000400_commission_payouts",
  "20260816000500_commission_earnings_privacy",
  "20260816000600_customer_demand_structured_columns",
  "20260816000700_create_customer_with_demand_rpc",
  "20260816000800_targets_activity_goals",
  "20260816000900_assignment_rules",
  "20260816001000_profiles_title_visibility_scope",
] as const;

const code = (path: string) => readFileSync(path, "utf8").replace(/--[^\n]*/g, "");
const up = (name: string) => code(`supabase/migrations/${name}.sql`);
const header = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, "utf8");

const NEW_TABLES: Record<string, string[]> = {
  "20260816000200_commission_splits": ["commission_splits"],
  "20260816000300_advisor_commission_plans": ["advisor_commission_plans"],
  "20260816000400_commission_payouts": ["commission_payouts"],
  "20260816000900_assignment_rules": ["assignment_rules", "assignment_rule_members"],
};

describe("Faz 2 migration dosyaları", () => {
  it("her migration için rollback dosyası var ve boş değil", () => {
    for (const name of NAMES) {
      expect(existsSync(`supabase/migrations/${name}.sql`), name).toBe(true);
      const rb = `supabase/rollbacks/${name}.rollback.sql`;
      expect(existsSync(rb), rb).toBe(true);
      expect(code(rb).trim().length, rb).toBeGreaterThan(0);
    }
  });

  it("her migration neden/geri alma/risk açıklaması taşır", () => {
    for (const name of NAMES) {
      const text = header(name);
      expect(text, name).toMatch(/GERİ ALMA/);
      expect(text, name).toMatch(/RİSK/);
    }
  });

  it("enum ADD VALUE yok, şemasız digest() yok, sıra numaraları artan", () => {
    for (const name of NAMES) {
      expect(up(name), name).not.toMatch(/add value/i);
      expect(up(name), name).not.toMatch(/(?<![.\w])digest\(/);
    }
    const sorted = [...NAMES].sort();
    expect([...NAMES]).toEqual(sorted);
  });

  it("yeni tablolar: RLS açık, tenant_id, current_tenant_id politikası, anon erişimi kapalı, rollback tabloyu düşürür", () => {
    for (const [name, tables] of Object.entries(NEW_TABLES)) {
      const sql = up(name);
      const rb = code(`supabase/rollbacks/${name}.rollback.sql`);
      for (const t of tables) {
        expect(sql, `${t} create`).toContain(`create table if not exists public.${t} `);
        expect(sql, `${t} rls`).toContain(`alter table public.${t} enable row level security`);
        expect(sql, `${t} select policy`).toContain(`create policy ${t}_select on public.${t}`);
        expect(sql, `${t} anon`).toMatch(new RegExp(`revoke all on table public\\.${t} from public, anon`));
        expect(sql, `${t} tenant_id`).toMatch(/tenant_id uuid not null references public\.tenants\(id\) on delete cascade/);
        expect(rb, `${t} rollback`).toContain(`drop table if exists public.${t}`);
      }
      expect(sql, name).toContain("public.current_tenant_id()");
      // Her politika tenant kapsamlı olmalı.
      const policies = sql.split("create policy ").slice(1);
      expect(policies.length, name).toBeGreaterThan(0);
      for (const p of policies) expect(p, `${name} policy tenant`).toContain("tenant_id = (select public.current_tenant_id())");
    }
  });

  it("yeni tablolara service_role kullanımı eklenmez (yalnız grant); bileşik tenant FK'leri var", () => {
    for (const name of Object.keys(NEW_TABLES)) {
      const sql = up(name);
      expect(sql).not.toMatch(/createAdminClient|service_role_key/i);
      expect(sql).toMatch(/foreign key \((profile_id|commission_id|rule_id), tenant_id\)|foreign key \(tenant_id, commission_id\)|foreign key \(split_id, tenant_id\)/);
    }
  });

  it("earnings_all seed: owner tam, gm/accounting yalnız view", () => {
    const sql = up(NAMES[0]);
    expect(sql).toContain("select 'owner', 'earnings_all'");
    expect(sql).toContain("('gm', 'earnings_all', 'view')");
    expect(sql).toContain("('accounting', 'earnings_all', 'view')");
    expect(sql).not.toMatch(/'gm', 'earnings_all', '(create|edit|delete)'/);
  });

  it("kazanç gizliliği: plan/hakediş SELECT kendi satırı veya earnings_all; yazma owner/gm", () => {
    for (const name of [NAMES[2], NAMES[3]]) {
      const sql = up(name);
      expect(sql).toContain("profile_id = (select auth.uid())");
      expect(sql).toContain("has_effective_permission('earnings_all', 'view')");
      expect(sql).toContain("in ('owner', 'gm')");
    }
  });

  it("kazanç gizliliği migration'ı: politika + maske, advisor_kpis imzası korunur, rollback eski gövdeyi döndürür", () => {
    const sql = up(NAMES[4]);
    expect(sql).toContain("alter policy commissions_select on public.commissions");
    expect(sql).toContain("can_view_commission_earnings");
    expect(sql).toContain("create or replace function public.advisor_kpis(");
    expect(sql).toMatch(/p_tenant_id uuid,\s+p_month_start timestamptz/);
    expect(sql).toContain("assigned_to uuid,\n  customer_count bigint,\n  call_count bigint,\n  appoint_count bigint,\n  offer_count bigint,\n  deal_count bigint,\n  revenue numeric");
    expect(sql).toContain("assert_current_tenant(p_tenant_id)");
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
    const rb = code(`supabase/rollbacks/${NAMES[4]}.rollback.sql`);
    expect(rb).toContain("create or replace function public.advisor_kpis(");
    expect(rb).toContain("drop function if exists public.can_view_commission_earnings");
    expect(rb).not.toContain("see_all");
  });

  it("hakediş: durum tutarlılığı, çift ödeme engeli, denetim trigger'ı", () => {
    const sql = up(NAMES[3]);
    expect(sql).toContain("'pending', 'approved', 'paid', 'cancelled'");
    expect(sql).toContain("commission_payouts_paid_consistency");
    expect(sql).toContain("uq_commission_payouts_active_split");
    expect(sql).toContain("insert into public.audit_logs");
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
  });

  it("create_customer_with_demand: SECURITY INVOKER, tenant eşleşmesi, tek fonksiyonda iki insert, anon kapalı", () => {
    const sql = up(NAMES[6]);
    expect(sql).toContain("security invoker");
    expect(sql).not.toMatch(/security definer/);
    expect(sql).toContain("p_tenant_id is distinct from v_tenant");
    expect(sql).toContain("insert into public.customers");
    expect(sql).toContain("insert into public.customer_demands");
    expect(sql).toMatch(/revoke all on function public\.create_customer_with_demand\([\s\S]*?from public, anon/);
    expect(sql).toMatch(/grant execute on function public\.create_customer_with_demand\([\s\S]*?to authenticated/);
  });

  it("sütun migration'ları additive: NOT NULL sütunların varsayılanı var, ayrı tablo açılmaz", () => {
    const demand = up(NAMES[5]);
    const targets = up(NAMES[7]);
    expect(demand).not.toMatch(/create table/i);
    expect(targets).not.toMatch(/create table/i);
    expect(targets).toMatch(/target_appointments integer not null default 0/);
    expect(demand).toMatch(/currency text not null default 'TRY'/);
    expect(demand).toMatch(/required_keys text\[\] not null default '\{\}'/);
  });

  it("profiles: nullable sütunlar + kapsam guard trigger'ı", () => {
    const sql = up(NAMES[9]);
    expect(sql).toContain("add column if not exists title text");
    expect(sql).toContain("add column if not exists visibility_scope text");
    expect(sql).toContain("'own', 'team', 'branch', 'office'");
    expect(sql).toContain("has_effective_permission('team', 'edit')");
  });
});
