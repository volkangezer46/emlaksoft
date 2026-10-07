import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { MIGRATION_GROUP_SPEC } from "../../../scripts/migration-pairs-data";
import {
  ANOMALY_SEVERITIES,
  ANOMALY_STATUSES,
  ANOMALY_TYPES,
  CHECK_RESULTS,
  CHECK_STATES,
  EXIT_KINDS,
  HEALTH_COLORS,
  LIFECYCLE_STAGES,
  REASON_CODES,
  SOURCE_KINDS,
} from "./types";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";

/**
 * SÖZLEŞME (statik, DB yok): ilan kontrol migration'ları ↔ TS sabitleri ↔ RLS/yetki kalıpları ↔ cron/allowlist sınırı.
 * SQL çalıştırılmaz; metin taranır (sql-rls-pattern-contract.test.ts ile aynı yaklaşım).
 */

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase", "migrations");
const RB_DIR = join(ROOT, "supabase", "rollbacks");
const LC = readdirSync(MIG_DIR).filter((f) => /^202608260020\d\d_lc_.*\.sql$/.test(f)).sort();
const sql = (name: string) => readFileSync(join(MIG_DIR, name), "utf8");
const allSql = () => LC.map(sql).join("\n");
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** `check (col in ('a','b'))` listesini döndürür. */
function checkList(text: string, column: string): string[] {
  const re = new RegExp(`${column}[^;]*?check\\s*\\(\\s*(?:${column}\\s+is\\s+null\\s+or\\s+)?${column}\\s+in\\s*\\(([^)]*)\\)`, "i");
  const m = text.match(re);
  if (!m) throw new Error(`check listesi bulunamadı: ${column}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("migration paketi yapısı", () => {
  it("sekiz ilan kontrol migration'ı vardır, numara aralığı 002000-002099", () => {
    expect(LC).toHaveLength(8);
    for (const f of LC) {
      const n = Number(f.slice(8, 14));
      expect(n).toBeGreaterThanOrEqual(2000);
      expect(n).toBeLessThanOrEqual(2099);
    }
  });

  it("her migration'ın rollback dosyası var ve ön-koşul bloğu + forward-only başlığı taşır", () => {
    for (const f of LC) {
      expect(existsSync(join(RB_DIR, f.replace(/\.sql$/, ".rollback.sql"))), `${f} rollback`).toBe(true);
      const t = sql(f);
      expect(t).toMatch(/UYGULANMADI/);
      expect(t).toMatch(/do \$\$[\s\S]*?raise exception/i);
      expect(t).toMatch(/set local lock_timeout/);
    }
  });

  it("migration-pairs-data.ts: hepsi etki sınıfı + pencere (order 29.80+) içinde", () => {
    const impact = MIGRATION_GROUP_SPEC.impact;
    const windowFiles = new Set(MIGRATION_GROUP_SPEC.windows.flatMap((w) => w.files));
    for (const f of LC) {
      expect(impact[f], `${f} etki sınıfı`).toBeDefined();
      expect(windowFiles.has(f), `${f} pencere`).toBe(true);
    }
    const ours = MIGRATION_GROUP_SPEC.windows.filter((w) => w.files.some((f) => LC.includes(f)));
    expect(ours.length).toBeGreaterThanOrEqual(3);
    for (const w of ours) expect(w.order).toBeGreaterThanOrEqual(29.8);
    expect(impact["20260826002000_lc_portal_listing_chain.sql"]).toBe("davranis");
  });

  it("zincir migration'ı: yinelenen canlı satırda DURAN ön-koşul + kısmi unique'ler + supersedes", () => {
    const t = sql("20260826002000_lc_portal_listing_chain.sql");
    expect(t).toMatch(/having count\(\*\) > 1/);
    expect(t).toMatch(/uq_portal_listings_live_external[\s\S]*where status = 'live'/);
    expect(t).toMatch(/uq_portal_listings_supersedes/);
    expect(t).toMatch(/supersedes_id/);
    // YENİ geçmiş tablosu AÇILMAZ: ilan no geçmişi satır zinciridir.
    expect(t).not.toMatch(/create table[^;]*portal_listing_id_history/i);
  });
});

describe("TS sabitleri ↔ SQL CHECK listeleri", () => {
  it("kontrol durumları, sonuçlar, kaynaklar", () => {
    const t = sql("20260826002020_lc_verification_tables.sql");
    expect(checkList(t, "check_state")).toEqual([...CHECK_STATES]);
    expect(checkList(t, "result")).toEqual([...CHECK_RESULTS]);
    expect(checkList(t.slice(t.indexOf("create table if not exists public.listing_verifications")), "source_kind")).toEqual([...SOURCE_KINDS]);
  });
  it("anomali türleri, önem, durumlar, açıklama nedenleri", () => {
    const t = sql("20260826002030_lc_anomaly_tables.sql");
    // Tür listesi 20261007000610'da 'closure_loss' ile genişledi (TS sabiti en son tanımla eşleşir).
    expect([...checkList(t, "type"), "closure_loss"]).toEqual([...ANOMALY_TYPES]);
    expect(checkList(readFileSync("supabase/migrations/20261007000610_closure_loss_anomalies.sql", "utf8"), "type")).toEqual([...ANOMALY_TYPES]);
    expect(checkList(t, "severity")).toEqual([...ANOMALY_SEVERITIES]);
    expect(checkList(t, "status")).toEqual([...ANOMALY_STATUSES]);
    expect(checkList(t, "explained_reason_code")).toEqual([...REASON_CODES]);
  });
  it("yaşam döngüsü, çıkış türü, renkler", () => {
    const t = sql("20260826002040_lc_property_control_state.sql");
    expect(checkList(t, "lifecycle_stage")).toEqual([...LIFECYCLE_STAGES]);
    expect(checkList(t, "exit_kind")).toEqual([...EXIT_KINDS]);
    expect(checkList(t, "health_color")).toEqual([...HEALTH_COLORS]);
  });
  it("açıklama nedenleri RPC'de de aynı (lc_explain_anomaly)", () => {
    const t = sql("20260826002060_lc_anomaly_rpcs.sql");
    for (const code of REASON_CODES) expect(t).toContain(`'${code}'`);
  });
});

describe("durum makinesi: SQL ↔ TS eşitliği", () => {
  const t = sql("20260826002050_lc_queue_and_check_rpcs.sql");
  const sm = DEFAULT_LISTING_CONTROL_CONFIG.stateMachine;
  it("güven sabitleri", () => {
    expect(t).toContain(`v_conf := ${sm.confidence.suspect.toFixed(2)}`);
    expect(t).toContain(`v_conf := ${sm.confidence.probable.toFixed(2)}`);
    expect(t).toContain(`v_conf := ${sm.confidence.confirmedMultiClient.toFixed(2)}`);
    expect(t).toContain(`v_conf := ${sm.confidence.confirmedSingleClient.toFixed(2)}`);
    expect(t).toContain(`v_conf := ${sm.confidence.manualAbsent.toFixed(2)}`);
    expect(t).toMatch(/when 'api' then 0\.95 when 'feed' then 0\.85 when 'csv' then 0\.85 when 'manual' then 0\.90 else 0\.70/);
  });
  it("eşikler ve üstel geri çekilme", () => {
    expect(t).toContain(`'min_gap_minutes')::integer, ${sm.minGapMinutes})`);
    expect(t).toContain(`'single_client_wait_hours')::integer, ${sm.singleClientWaitHours})`);
    expect(t).toContain(`'normal_hours')::integer, ${DEFAULT_LISTING_CONTROL_CONFIG.cadence.normalHours})`);
    expect(t).toContain("case when v_authoritative then 2 else 3 end");
    expect(t).toMatch(/least\(240, 30 \* \(2 \^ least\(v_failures - 1, 3\)\)::integer\)/);
  });
  it("blocked/error sayaç ARTIRMAZ ve durumu kayba çevirmez", () => {
    const branch = t.slice(t.indexOf("blocked / error"), t.indexOf("update public.portal_listing_health set"));
    expect(branch).not.toMatch(/v_absent\s*:=/);
    expect(branch).toMatch(/'unverifiable'/);
  });
  it("aynı iş iki kez işlenmez ve kuyruk SKIP LOCKED", () => {
    expect(t).toMatch(/v_job\.status = 'completed'[\s\S]*'replay'/);
    expect(t).toMatch(/for update skip locked/);
    expect(sql("20260826002020_lc_verification_tables.sql")).toMatch(/uq_listing_verification_jobs_open[\s\S]*status in \('queued', 'claimed'\)/);
    expect(sql("20260826002020_lc_verification_tables.sql")).toMatch(/uq_listing_verifications_job/);
  });
});

describe("RLS / yetki kalıpları", () => {
  const text = allSql().toLowerCase();
  const tables = [...text.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

  it("her yeni tabloda RLS açık, tenant_id var ve authenticated'a YAZMA verilmez", () => {
    expect(tables.sort()).toEqual(
      [
        "listing_anomalies", "listing_anomaly_actions", "listing_matching_candidates", "listing_sla_events", "listing_verification_jobs",
        "listing_verifications", "portal_listing_health", "property_control_state", "verification_clients",
      ].sort(),
    );
    for (const tb of tables) {
      expect(text, `${tb} RLS`).toMatch(new RegExp(`alter table public\\.${tb} enable row level security`));
      expect(text, `${tb} yazma grant`).not.toMatch(new RegExp(`grant[^;]*\\b(insert|update|delete|all)\\b[^;]*on (table )?public\\.${tb} to[^;]*authenticated`));
      expect(text, `${tb} yazma politikası`).not.toMatch(new RegExp(`create policy \\w+ on public\\.${tb} for (insert|update|delete|all)`));
    }
  });

  it("okuma politikaları InitPlan sarmalı ve rol kapsamı (lc_row_visible) kullanır", () => {
    for (const name of ["portal_listing_health_select", "listing_verifications_select", "listing_anomalies_select", "property_control_state_select"]) {
      const m = text.match(new RegExp(`create policy ${name}[\\s\\S]*?;\\n`))?.[0] ?? "";
      expect(m, name).toContain("(select public.current_tenant_id())");
      expect(m, name).toContain("(select public.lc_row_visible(");
      expect(m, name).toContain("has_effective_permission('portals', 'view')");
    }
  });

  it("verification_clients: token_hash istemciye sütun bazlı kapalı", () => {
    const t = sql("20260826002020_lc_verification_tables.sql");
    expect(t).toMatch(/grant select \([^)]*\)\s+on table public\.verification_clients to authenticated/);
    expect(t.match(/grant select \(([^)]*)\)\s+on table public\.verification_clients/)?.[1]).not.toContain("token_hash");
  });

  it("her SECURITY DEFINER fonksiyonda set search_path var", () => {
    const funcs = allSql().split(/create or replace function /i).slice(1);
    expect(funcs.length).toBeGreaterThan(15);
    for (const f of funcs) {
      const head = f.slice(0, f.indexOf("$$"));
      if (/security definer/i.test(head)) expect(head, f.slice(0, 60)).toMatch(/set search_path\s*=\s*''/i);
    }
  });

  it("service_role RPC'leri anon/authenticated'tan geri alınır; kullanıcı RPC'leri anon'a kapalı", () => {
    const t = allSql();
    for (const fn of [
      "lc_rotate_portal_listing", "lc_bind_portal_listing", "lc_enqueue_verification_jobs", "lc_claim_verification_jobs",
      "lc_reap_verification_jobs", "lc_complete_listing_check", "lc_sync_anomalies", "lc_escalate_anomaly",
      "lc_register_matching_candidates", "lc_decide_matching_candidate", "lc_upsert_control_states", "lc_sweep_candidates",
    ]) {
      expect(t, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`));
      expect(t, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
    }
    for (const fn of ["lc_submit_manual_check", "lc_acknowledge_anomaly", "lc_explain_anomaly", "lc_resolve_anomaly"]) {
      expect(t, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
      expect(t, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`));
    }
    // İç çekirdekler hiçbir role açılmaz
    expect(t).toMatch(/revoke all on function public\.lc_apply_check\([^)]*\) from public, anon, authenticated, service_role/);
    expect(t).not.toMatch(/grant execute on function public\.lc_apply_check/);
    expect(t).not.toMatch(/grant execute on function public\.lc_mark_state_stale/);
  });

  it("kullanıcı RPC'leri JWT'den ofis/kullanıcı çıkarır; tenant parametresi KABUL ETMEZ", () => {
    const t = sql("20260826002060_lc_anomaly_rpcs.sql");
    for (const fn of ["lc_acknowledge_anomaly", "lc_explain_anomaly", "lc_resolve_anomaly"]) {
      const body = t.slice(t.indexOf(`function public.${fn}(`));
      const sig = body.slice(0, body.indexOf(")"));
      expect(sig).not.toMatch(/p_tenant_id/);
      const fnBody = body.slice(0, body.indexOf("$$;", body.indexOf("as $$")));
      expect(fnBody).toContain("public.current_tenant_id()");
      expect(fnBody).toContain("has_effective_permission('portals', 'edit')");
      expect(fnBody).toContain("lc_row_visible(");
    }
    expect(sql("20260826002050_lc_queue_and_check_rpcs.sql").slice(sql("20260826002050_lc_queue_and_check_rpcs.sql").indexOf("function public.lc_submit_manual_check("))).toContain("has_effective_permission('portals', 'edit')");
  });

  it("açıklama zorunluluğu SQL'de: nedensiz kapatma ve notsuz 'diğer' reddedilir", () => {
    const t = sql("20260826002060_lc_anomaly_rpcs.sql");
    expect(t).toContain("'reason_required'");
    expect(t).toContain("'note_required'");
    expect(t).toContain("'explanation_required'");
  });

  it("portal_listings guard sözleşmesi: RPC'ler authenticated'a açılmaz, doğrudan grant verilmez", () => {
    const t = allSql().toLowerCase();
    expect(t).not.toMatch(/grant[^;]*on (table )?public\.portal_listings to[^;]*authenticated/);
    expect(t).not.toMatch(/grant execute on function public\.lc_(rotate|bind)_portal_listing[^;]*authenticated/);
  });

  it("market gorunumu yalniz service_role'e acik", () => {
    const t = sql("20260826002070_lc_summary_rpcs_market_view.sql");
    expect(t).toMatch(/revoke all on table public\.control_market_signals_v from public, anon, authenticated/);
    expect(t).toMatch(/grant select on table public\.control_market_signals_v to service_role/);
    const view = t.slice(t.indexOf("create or replace view public.control_market_signals_v"), t.indexOf("revoke all on table public.control_market_signals_v"));
    for (const forbidden of ["property_code", "address_line", "assigned_to", "owner", "p.id as", "p.title", "full_name"]) {
      expect(view.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    // Çıktı sütunlarında ilan/portföy kimliği yok (ara CTE'de property_id kullanılabilir).
    const outputList = view.slice(view.indexOf("select\n  p.tenant_id"));
    expect(outputList).not.toMatch(/\bas property_id\b|^\s*p\.id,/m);
  });
});

describe("sunucu katmanı sınırları", () => {
  const files = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
  const libFiles = files("src/lib/listing-control").filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));

  it("src/lib/listing-control createAdminClient ÇAĞIRMAZ (istemci enjekte edilir; allowlist'e satır gerekmez)", () => {
    for (const f of libFiles) expect(src(f), f).not.toMatch(/createAdminClient\s*\(/);
  });

  it("Date.now() / argümansız new Date() YOK (clock.ts kuralı); doğrudan api.openai.com YOK", () => {
    for (const f of libFiles) {
      const t = src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(t, f).not.toMatch(/Date\.now\(\)/);
      expect(t, f).not.toMatch(/new Date\(\s*\)/);
      expect(t, f).not.toContain("api.openai.com");
    }
  });

  it("portal sayfası çekme / scraping / CAPTCHA aşma kodu YOK: adaptörler ağ çağrısı yapmaz", () => {
    for (const f of files("src/lib/listing-control/adapters").filter((x) => /\.ts$/.test(x) && !x.endsWith(".test.ts"))) {
      const t = src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(t, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|puppeteer|playwright|axios|https?\.request/);
    }
  });

  it("kullanıcı action'ları requirePermission('portals', ...) kapısından geçer ve service_role kullanmaz", () => {
    const t = src("src/app/actions/listing-control.ts");
    expect(t).not.toContain("createAdminClient");
    const exported = [...t.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(exported.sort()).toEqual(["acknowledgeAnomaly", "explainAnomaly", "resolveAnomaly", "submitManualCheck"]);
    expect([...t.matchAll(/requirePermission\("portals", "edit"\)/g)]).toHaveLength(exported.length);
  });

  it("allowlist'e satır EKLENMEDİ: yeni dosyalar listede yok", () => {
    const t = src("src/lib/admin-client-allowlist.ts");
    expect(t).not.toContain("listing-control");
  });

  it("PostgREST gömmesi FK adıyla (leak-sla)", () => {
    expect(src("src/app/api/cron/leak-sla/route.ts")).toContain("properties!portal_listings_property_id_fkey(id,property_code,title)");
  });
});

describe("cron: MEVCUT cron'lar genişletildi, yeni cron EKLENMEDİ", () => {
  it("vercel.json cron sayısı CRON_JOBS ile aynı ve ilan-kontrol adında cron yok", () => {
    const vercel = JSON.parse(src("vercel.json")) as { crons: { path: string }[] };
    expect(vercel.crons).toHaveLength(CRON_JOBS.length);
    expect(vercel.crons.some((c) => /ilan-kontrol/.test(c.path))).toBe(false);
    expect(existsSync(join(ROOT, "src/app/api/cron/ilan-kontrol-planla"))).toBe(false);
  });

  it("havuz-atama, portal-teyit, leak-sla ilan kontrol adımlarını çağırır ve CRON_SECRET kapısı korunur", () => {
    const hav = src("src/app/api/cron/havuz-atama/route.ts");
    expect(hav).toContain("runControlStepFrequent");
    expect(hav).toMatch(/authorizeCron\(req\)/);
    expect(hav).toMatch(/recordHeartbeat\(\s*"havuz-atama"/);
    const teyit = src("src/app/api/cron/portal-teyit/route.ts");
    expect(teyit).toContain("runControlStepBroad");
    expect(teyit).toContain("portal_listing_health");
    const leak = src("src/app/api/cron/leak-sla/route.ts");
    expect(leak).toContain("potential_lost_deal");
    expect(leak).toContain('from "@/lib/listing-control/sla-plan"');
    // Her biri tek createAdminClient çağrısı (allowlist `calls: 1` ile uyumlu).
    for (const s of [hav, teyit, leak]) expect(s.match(/createAdminClient\s*\(/g)).toHaveLength(1);
  });

  it("modül kapısı: havuz-atama 'portals' kapalı ofisleri atlar", () => {
    expect(src("src/app/api/cron/havuz-atama/route.ts")).toMatch(/tenantsDisabledFor\([\s\S]*?"portals"\)/);
  });
});

describe("portal-publish: bozuk upsert kaldırıldı", () => {
  it("onConflict 'tenant_id,property_id,portal_name' artık yok; RPC + geri dönüş var", () => {
    const t = src("src/app/actions/portal-publish.ts");
    expect(t).not.toContain('onConflict: "tenant_id,property_id,portal_name"');
    expect(t).toContain("lc_bind_portal_listing");
    expect(t).toContain("lc_rotate_portal_listing");
    expect(t).toContain("isMissingSchema");
  });
  it("createPortalListing: ilan no değişimi supersedes_id ile, aynı createAdminClient çağrısı", () => {
    const t = src("src/app/actions/portal-listings.ts");
    expect(t).toContain("supersedes_id");
    expect(t).toContain("lc_rotate_portal_listing");
    expect(t.match(/createAdminClient\s*\(/g)).toHaveLength(4); // create, confirm, bulk, close (önceki: 4)
  });
});
