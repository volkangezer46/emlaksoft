import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_TABLES } from "@/lib/realtime-throttle";
import { walkSource } from "@/lib/test-support/src-tree";

// scripts/ tsconfig kapsami disinda: kabul listesi yalniz vitest'te, degiskenle verilen yoldan yuklenir (function-acl-gate.test.ts deseni).
type AllowlistModule = { ANON_FUNCTION_ALLOWLIST: Record<string, { reason: string; note: string }> };
const allowlistPath = "../../scripts/function-acl-allowlist.ts";
const { ANON_FUNCTION_ALLOWLIST } = (await import(/* @vite-ignore */ allowlistPath)) as AllowlistModule;

/**
 * KQ2 (RLS maliyeti ve DB yuzeyi) SOZLESMESI — 20261015010000..20261015017000.
 * Davranis (rol matrisi, onbellek gecersizligi, eski/yeni metrik esitligi, anon 'permission denied') pgTAP ile gölgede
 * sinanir: supabase/tests/kq2_*.test.sql. Bu dosya statik kilitleri tutar:
 *  (1) Realtime yayin listesi = kodda GERCEKTEN abone olunan tablolar (iki yonlu; sonraki migration'larin ekleme/cikarmasi sayilir),
 *  (2) politika yeniden yazimlari satir basina DEFINER cagrisina geri donmez,
 *  (3) kimlik onbellegi 2FA/kiraci kapisini korur ve islem-yerel yazar,
 *  (4) anon'dan geri alinan RPC'ler kabul listesinde yok ve yalniz oturumlu yollardan cagrilir,
 *  (5) her migration'in rollback'i, gecis kaydi ve pgTAP testi var.
 */
const ROOT = process.cwd();
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const mig = (name: string) => read(`supabase/migrations/${name}.sql`);

const KQ2 = [
  "20261015010000_commissions_rls_initplan",
  "20261015011000_lc_finance_rls_initplan",
  "20261015012000_identity_txn_cache",
  "20261015013000_metrics_snapshot_single_pass",
  "20261015014000_index_hygiene",
  "20261015015000_agent_photos_bucket_limits",
  "20261015016000_revoke_anon_definer_rpcs",
  "20261015017000_realtime_publication_trim",
] as const;

/** SQL'den yorum satirlarini atar (sozlesme kontrolleri yorumdaki adlara takilmasin). */
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

/** Kodda postgres_changes ile abone olunan tablolar: rota kanali + zil + ilan kontrol + destek + pano TV. */
function subscribedTables(): Set<string> {
  const out = new Set<string>(ROUTE_TABLES.flatMap(([, tables]) => tables));
  for (const file of walkSource(resolve(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    if (!/useRealtimeRefresh\(|subscribeToInserts|postgres_changes/.test(text)) continue;
    // useRealtimeRefresh({ tables: ["x", ...] })
    for (const m of text.matchAll(/useRealtimeRefresh\(\{[^}]*\btables:\s*\[([^\]]*)\]/g)) {
      for (const t of m[1].matchAll(/"([a-z_]+)"/g)) out.add(t[1]);
    }
    // subscribeToInserts({ ..., table: "x" }) ve postgres_changes { ..., table: "x" }
    for (const m of text.matchAll(/\btable:\s*"([a-z_]+)"/g)) out.add(m[1]);
    // const RT_TABLES = ["x", ...] (pano TV: subscribeToInserts tablo listesi)
    for (const m of text.matchAll(/const\s+RT_TABLES\s*=\s*\[([^\]]*)\]/g)) {
      for (const t of m[1].matchAll(/"([a-z_]+)"/g)) out.add(t[1]);
    }
  }
  return out;
}

function keepList(): string[] {
  const sql = mig("20261015017000_realtime_publication_trim");
  const m = /keep constant text\[\] := array\[([\s\S]*?)\];/.exec(sql);
  if (!m) throw new Error("keep listesi bulunamadi");
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

/** 20261015017000'den SONRAKI migration'larin yayina ekledigi / cikardigi tablolar. */
function laterPublicationChanges(): { added: Set<string>; dropped: Set<string> } {
  const added = new Set<string>();
  const dropped = new Set<string>();
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql") && f > "20261015017000_realtime_publication_trim.sql").sort();
  for (const f of files) {
    const sql = stripComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(/alter publication supabase_realtime add table (?:public\.)?([a-z_]+)/gi)) added.add(m[1]);
    for (const m of sql.matchAll(/alter publication supabase_realtime drop table (?:public\.)?([a-z_]+)/gi)) dropped.add(m[1]);
  }
  return { added, dropped };
}

describe("KQ2 Realtime yayini: yalniz kodda abone olunan tablolar", () => {
  const keep = keepList();
  const subs = subscribedTables();
  const later = laterPublicationChanges();

  it("tarama gercek abonelikleri bulur (zil, ilan kontrol, destek, rota kanali)", () => {
    for (const t of ["notifications", "listing_control_events", "support_ticket_messages", "support_ticket_attachments", "customers", "tasks"]) {
      expect(subs.has(t), t).toBe(true);
    }
  });

  it("abone olunan her tablo yayinda kalir (keep listesi ya da sonraki migration ekler)", () => {
    const missing = [...subs].filter((t) => !keep.includes(t) && !later.added.has(t));
    expect(missing).toEqual([]);
  });

  it("keep listesinde kodda dinlenmeyen tablo yok (ya da sonraki migration cikarmis)", () => {
    const dead = keep.filter((t) => !subs.has(t) && !later.dropped.has(t));
    expect(dead).toEqual([]);
  });

  it("migration yalniz DROP eder, tablo EKLEMEZ ve FOR ALL TABLES yayinina dokunmaz", () => {
    const sql = stripComments(mig("20261015017000_realtime_publication_trim"));
    expect(sql).not.toMatch(/add table/i);
    expect(sql).toMatch(/puballtables/);
    expect(sql).toContain("alter publication supabase_realtime drop table %I.%I");
  });
});

describe("KQ2 RLS yeniden yazimlari satir basina DEFINER cagrisina donmez", () => {
  it("commissions_select: satirdan bagimsiz kontroller (select ...) InitPlan, can_view_commission_earnings politikada yok", () => {
    const sql = stripComments(mig("20261015010000_commissions_rls_initplan"));
    expect(sql).toContain("alter policy commissions_select on public.commissions");
    expect(sql).not.toContain("can_view_commission_earnings(");
    expect(sql).toContain("(select public.has_effective_permission('commissions', 'view'))");
    expect(sql).toContain("(select public.has_effective_permission('earnings_all', 'view'))");
    expect(sql).toContain("d.assigned_to = (select auth.uid())");
    expect(sql).toContain("s.profile_id = (select auth.uid())");
  });

  it("ilan kontrol ve ekstre politikalari: lc_row_visible / finance_account_access satir argumaniyla cagrilmaz", () => {
    const sql = stripComments(mig("20261015011000_lc_finance_rls_initplan"));
    expect(sql).not.toMatch(/lc_row_visible\(/);
    expect(sql).not.toMatch(/finance_account_access\(/);
    for (const t of ["listing_anomalies", "listing_control_events", "listing_verifications", "portal_listing_health", "property_control_state", "lc_lifecycle_events"]) {
      expect(sql, t).toContain(`'${t}'`);
    }
    for (const fn of ["lc_scope_sees_all", "lc_scope_branch_id", "lc_scope_team_id", "lc_scope_advisor_id"]) {
      expect(sql, fn).toContain(`(select public.${fn}())`);
      expect(sql, fn).toContain(`revoke all on function public.${fn}() from public, anon;`);
    }
    expect(sql).toContain("alter policy finance_statement_imports_select");
    expect(sql).toContain("alter policy finance_statement_mappings_select");
  });
});

describe("KQ2 kimlik onbellegi", () => {
  const sql = stripComments(mig("20261015012000_identity_txn_cache"));

  it("2FA ve kiraci durumu kapisi korunur (her iki dal)", () => {
    expect(sql.match(/public\.current_session_two_factor_satisfied\(\)/g)?.length).toBe(2);
    expect(sql.match(/t\.status not in \('suspended', 'cancelled'\)/g)?.length).toBe(2);
    expect(sql).toContain("and p.role = nullif(btrim(auth.jwt() -> 'app_metadata' ->> 'role'), '')");
    expect(sql).toContain("and pis.expires_at > now()");
  });

  it("onbellek yalniz islem-yerel ve claim + nesil anahtarli", () => {
    for (const name of ["app.ctx_tenant", "app.ctx_role"]) {
      expect(sql).toContain(`set_config('${name}', k || `);
    }
    expect(sql).toContain("PERFORM set_config(gname, k || ");
    expect(sql).not.toMatch(/set_config\([^)]*,\s*false\)/);
    expect(sql.match(/current_setting\('request\.jwt\.claims', true\)/g)?.length).toBe(3);
    expect(sql.match(/current_setting\('app\.ctx_gen', true\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("nesil sayaci kimlik tablolarina AFTER STATEMENT baglanir", () => {
    for (const t of ["profiles", "tenants", "tenant_role_permissions", "user_permission_overrides", "permission_defaults",
      "two_factor_verified_sessions", "platform_staff", "platform_impersonation_sessions"]) {
      expect(sql, t).toContain(`'${t}'`);
    }
    expect(sql).toContain("for each statement execute function public.ident_ctx_bump()");
    expect(sql).toContain("revoke all on function public.ident_ctx_bump() from public, anon, authenticated;");
  });
});

describe("KQ2 anon EXECUTE geri alma", () => {
  const REVOKED = ["aidat_kpi", "tcmb_rate_on", "increment_template_usage"];

  it("geri alinan RPC'ler anon kabul listesinde yok; token/public RPC'ler duruyor", () => {
    for (const fn of REVOKED) {
      expect(Object.keys(ANON_FUNCTION_ALLOWLIST).some((k) => k.startsWith(`public.${fn}(`)), fn).toBe(false);
    }
    for (const fn of ["contract_signer_resolve_short", "portal_customer_request", "portal_rent_receipt_target",
      "decide_property_price_proposal_by_token", "growth_invite_preview", "vitrin_chat_context", "api_v1_list"]) {
      expect(Object.keys(ANON_FUNCTION_ALLOWLIST).some((k) => k.startsWith(`public.${fn}(`)), fn).toBe(true);
    }
  });

  it("geri alinan RPC'ler yalniz oturumlu yollardan cagrilir (anon/public sayfa ya da rota cagirmaz)", () => {
    const allowedCallers = [/\/src\/app\/app\//, /\/src\/app\/actions\/message-templates\.ts$/];
    for (const file of walkSource(resolve(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      for (const fn of REVOKED) {
        if (!new RegExp(`rpc\\(\\s*["'\`]${fn}["'\`]`).test(text)) continue;
        expect(allowedCallers.some((re) => re.test(file.replace(/\\/g, "/"))), `${fn} <- ${file}`).toBe(true);
      }
    }
  });

  it("migration RPC'lerde authenticated/service_role'u acikca korur", () => {
    const sql = stripComments(mig("20261015016000_revoke_anon_definer_rpcs"));
    expect(sql).toContain("revoke execute on function %s from public, anon");
    expect(sql).toContain("grant execute on function %s to authenticated, service_role");
    for (const fn of ["public.aidat_kpi()", "public.tcmb_rate_on(date)", "public.increment_template_usage(uuid)"]) {
      expect(sql, fn).toContain(`'${fn}'`);
    }
  });
});

describe("KQ2 dosya butunlugu", () => {
  const pairs = read("scripts/migration-pairs-data.ts");
  for (const name of KQ2) {
    it(`${name}: rollback + gecis kaydi + forward-only kilit zaman araligi`, () => {
      expect(existsSync(resolve(ROOT, `supabase/rollbacks/${name}.rollback.sql`))).toBe(true);
      expect(pairs).toContain(`"${name}.sql"`);
      const version = name.slice(0, 14);
      expect(version >= "20261015010000" && version <= "20261015019999").toBe(true);
      expect(mig(name)).toContain("set local lock_timeout = '5s';");
    });
  }

  it("pgTAP testleri mevcut ve islem sonunda geri alinir", () => {
    for (const t of ["kq2_commissions_rls", "kq2_lc_finance_rls", "kq2_identity_cache", "kq2_metrics_snapshot", "kq2_db_surface"]) {
      const sql = read(`supabase/tests/${t}.test.sql`);
      expect(sql, t).toMatch(/^begin;/m);
      expect(sql, t).toMatch(/select plan\(\d+\);/);
      expect(sql.trimEnd().endsWith("rollback;"), t).toBe(true);
    }
  });

  it("get_metrics_snapshot cikti anahtarlari degismez", () => {
    const sql = mig("20261015013000_metrics_snapshot_single_pass");
    for (const key of ["'version', 1", "'computed_at'", "'sample_included'", "'kpi'", "'demands'", "'period'", "'decisions'",
      "'expiring_authority'", "'customer_count'", "'property_count'", "'calls_today'", "'calls_yesterday'",
      "'customers_this_month'", "'customers_prev_month'", "'call_dates'", "'customer_dates'", "'customer_dates_90'",
      "'demand_dates_90'", "'approvals_pending'", "'lost_this_month'", "'overdue_rent'", "'passive_days'", "'passive_advisors'"]) {
      expect(sql, key).toContain(key);
    }
    expect(sql).toContain("count(*) filter");
  });
});
