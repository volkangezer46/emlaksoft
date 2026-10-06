import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { INSIGHT_KINDS, INSIGHT_SEVERITIES, INSIGHT_STATES } from "@/lib/insights/types";

/**
 * SÖZLEŞME: Insight Engine şeması + kablolaması (statik; DB, ağ yok).
 * - şemada href NOT NULL, dedupe unique, RLS politikaları var, örnek veri üretilemez (sample_scope = false);
 * - set_state RPC definer + search_path, alıcıya bağlı; olgu RPC'leri yalnız service_role;
 * - cron kablolaması, service_role için YENİ createAdminClient kullanımı yok, ana ekran dosyalarına dokunulmadı.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const strip = (sql: string) => sql.replace(/--[^\n]*/g, "").toLowerCase();

const INSIGHTS = strip(read("supabase/migrations/20260826002500_insights.sql"));
const PLATFORM = strip(read("supabase/migrations/20260826002600_platform_insights.sql"));
const SUPPORT = strip(read("supabase/migrations/20260826002700_insight_support.sql"));

describe("insights tablosu şeması", () => {
  it("href NOT NULL ve '/' ile başlar (sıfır çıkmaz metrik)", () => {
    expect(INSIGHTS).toMatch(/href\s+text not null check \(char_length\(href\) between 1 and 500 and href like '\/%'\)/);
    expect(PLATFORM).toMatch(/href\s+text not null check \(char_length\(href\) between 1 and 500 and href like '\/%'\)/);
  });

  it("dedupe anahtarı benzersiz: (tenant_id, recipient_user_id, dedupe_key) / (staff_id, dedupe_key)", () => {
    expect(INSIGHTS).toMatch(/dedupe_key\s+text not null/);
    expect(INSIGHTS).toMatch(/unique \(tenant_id, recipient_user_id, dedupe_key\)/);
    expect(PLATFORM).toMatch(/unique \(staff_id, dedupe_key\)/);
  });

  it("tenant_id zorunlu + RLS açık; alıcı kendi satırını okur, owner/gm ofisini okur; yazma politikası YOK", () => {
    expect(INSIGHTS).toMatch(/tenant_id\s+uuid not null references public\.tenants\(id\) on delete cascade/);
    expect(INSIGHTS).toContain("alter table public.insights enable row level security");
    expect(INSIGHTS).toMatch(/create policy insights_select on public\.insights\s+for select/);
    expect(INSIGHTS).toContain("recipient_user_id = (select auth.uid())");
    expect(INSIGHTS).toMatch(/in \('owner', 'gm'\)/);
    expect(INSIGHTS).toContain("tenant_id = (select public.current_tenant_id())");
    expect(INSIGHTS).not.toMatch(/create policy \w+ on public\.insights\s+for (all|insert|update|delete)/);
    expect(INSIGHTS).toMatch(/revoke all on public\.insights from anon, authenticated/);
    expect(INSIGHTS).toMatch(/grant select on public\.insights to authenticated/);
    expect(INSIGHTS).toMatch(/grant all on public\.insights to service_role/);
  });

  it("platform tablosu: RLS açık, alıcı = auth.uid() VE platform personeli, yazma politikası yok", () => {
    expect(PLATFORM).toContain("alter table public.platform_insights enable row level security");
    expect(PLATFORM).toMatch(/for select using \(staff_id = \(select auth\.uid\(\)\) and \(select public\.is_platform_staff\(\)\)\)/);
    expect(PLATFORM).not.toMatch(/create policy \w+ on public\.platform_insights\s+for (all|insert|update|delete)/);
  });

  it("ÖRNEK VERİ ofiste içgörü üretmez: sample_scope yalnız false olabilir", () => {
    expect(INSIGHTS).toMatch(/sample_scope\s+boolean not null default false check \(sample_scope = false\)/);
  });

  it("durum/şiddet/tür kapalı listeleri TypeScript tipleriyle aynı", () => {
    for (const k of INSIGHT_KINDS) expect(INSIGHTS, k).toContain(`'${k}'`);
    for (const s of INSIGHT_SEVERITIES) expect(INSIGHTS, s).toContain(`'${s}'`);
    for (const s of INSIGHT_STATES) expect(INSIGHTS, s).toContain(`'${s}'`);
  });

  it("okuyucu kısmi indeksi (alıcı, öncelik) ve son geçerlilik indeksi var", () => {
    expect(INSIGHTS).toMatch(/on public\.insights \(tenant_id, recipient_user_id, priority desc\)\s+where state in \('new', 'seen', 'snoozed'\)/);
    expect(INSIGHTS).toMatch(/on public\.insights \(tenant_id, valid_until\)/);
  });
});

describe("insight_set_state RPC", () => {
  it("SECURITY DEFINER + boş search_path; yalnız alıcının kendi satırı; kapanmış satır yeniden açılmaz", () => {
    const fn = INSIGHTS.slice(INSIGHTS.indexOf("create or replace function public.insight_set_state"));
    expect(fn).toMatch(/security definer\s+set search_path = ''/);
    expect(fn).toContain("i.recipient_user_id = v_uid");
    expect(fn).toContain("i.tenant_id = v_tenant");
    expect(fn).toContain("v_uid uuid := auth.uid()");
    expect(fn).toMatch(/i\.state not in \('dismissed', 'accepted'\)/);
    expect(fn).toMatch(/revoke all on function public\.insight_set_state\(uuid, text, text, timestamptz, uuid\) from public, anon/);
    expect(fn).toMatch(/grant execute on function public\.insight_set_state\(uuid, text, text, timestamptz, uuid\) to authenticated, service_role/);
  });

  it("platform ikizi personel kapısı taşır", () => {
    const fn = PLATFORM.slice(PLATFORM.indexOf("create or replace function public.platform_insight_set_state"));
    expect(fn).toMatch(/security definer\s+set search_path = ''/);
    expect(fn).toContain("not public.is_platform_staff()");
    expect(fn).toContain("i.staff_id = v_uid");
  });
});

describe("olgu RPC'leri ve destek nesneleri", () => {
  const FNS = [
    "insight_quiet_valuable_customers(uuid, int, int)",
    "insight_stalled_deals(uuid, int, int)",
    "insight_weekly_series(uuid, text, int)",
    "insight_stale_listings(uuid, int, int)",
    "insight_deadlines(uuid, int, int)",
    "insight_housekeeping(int, int)",
  ];

  it("hepsi definer + boş search_path, YALNIZ service_role (anon/authenticated/public revoke)", () => {
    for (const f of FNS) {
      const name = f.split("(")[0];
      expect(SUPPORT, name).toMatch(new RegExp(`create or replace function public\\.${name}\\(`));
      expect(SUPPORT, f).toContain(`revoke all on function public.${f} from public, anon, authenticated`);
      expect(SUPPORT, f).toContain(`grant execute on function public.${f} to service_role`);
    }
    const defs = SUPPORT.split("create or replace function").slice(1);
    expect(defs).toHaveLength(FNS.length);
    for (const d of defs) expect(d).toMatch(/security definer\s+set search_path = ''/);
  });

  it("her olgu RPC'si tenant filtreli ve örnek veriyi (is_sample) dışarıda bırakır", () => {
    for (const name of ["insight_quiet_valuable_customers", "insight_stalled_deals", "insight_weekly_series", "insight_stale_listings", "insight_deadlines"]) {
      const start = SUPPORT.indexOf(`function public.${name}(`);
      const body = SUPPORT.slice(start, SUPPORT.indexOf("$$;", SUPPORT.indexOf("$$", start) + 2));
      expect(body, name).toContain("p_tenant_id");
      expect(body, name).toMatch(/is_sample = false/);
    }
  });

  it("kalite görünümü security_invoker ve yalnız service_role", () => {
    expect(SUPPORT).toMatch(/create or replace view public\.insight_rule_quality\s+with \(security_invoker = true\)/);
    expect(SUPPORT).toContain("revoke all on public.insight_rule_quality from public, anon, authenticated");
    expect(SUPPORT).toContain("grant select on public.insight_rule_quality to service_role");
    expect(SUPPORT).toContain("dismissed_wrong");
    expect(SUPPORT).toContain("wrong_rate_pct");
  });

  it("temizlik fonksiyonu süresi geçmiş ve kapanmış satırları siler", () => {
    expect(SUPPORT).toMatch(/delete from public\.insights i\s+where i\.state in \('new', 'seen', 'snoozed'\)/);
    expect(SUPPORT).toMatch(/delete from public\.insights i\s+where i\.state in \('dismissed', 'accepted'\)/);
  });
});

describe("rollback + migration ayrıntıları", () => {
  it("her migration için rollback dosyası var ve nesneleri düşürür", () => {
    const r1 = read("supabase/rollbacks/20260826002500_insights.rollback.sql");
    expect(r1).toContain("drop table if exists public.insights");
    expect(r1).toContain("drop function if exists public.insight_set_state");
    const r2 = read("supabase/rollbacks/20260826002600_platform_insights.rollback.sql");
    expect(r2).toContain("drop table if exists public.platform_insights");
    const r3 = read("supabase/rollbacks/20260826002700_insight_support.rollback.sql");
    expect(r3).toContain("drop view if exists public.insight_rule_quality");
    for (const n of ["insight_housekeeping", "insight_deadlines", "insight_stale_listings", "insight_weekly_series", "insight_stalled_deals", "insight_quiet_valuable_customers"]) {
      expect(r3, n).toContain(`drop function if exists public.${n}`);
    }
  });

  it("notifications ile BİRLEŞTİRİLMEDİ: notifications tablosuna dokunulmaz", () => {
    for (const sql of [INSIGHTS, PLATFORM, SUPPORT]) {
      expect(sql).not.toMatch(/alter table public\.notifications/);
      expect(sql).not.toMatch(/create table[^;]*public\.notifications/);
    }
  });

  it("enum ADD VALUE yok (CHECK kısıtları kullanıldı)", () => {
    for (const sql of [INSIGHTS, PLATFORM, SUPPORT]) expect(sql).not.toMatch(/add value/);
  });
});

describe("cron kablolaması", () => {
  it("insight-engine: CRON_JOBS + vercel.json + route birbirini tutuyor, sayı 36", () => {
    const job = CRON_JOBS.find((c) => c.job === "insight-engine");
    expect(job?.path).toBe("/api/cron/insight-engine");
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.find((c) => c.path === job?.path)?.schedule).toBe(job?.schedule);
    expect(vercel.crons.length).toBe(CRON_JOBS.length);
    expect(CRON_JOBS.length).toBe(36);
  });

  it("route: authorizeCron + recordHeartbeat literal + maxDuration 300; service_role yalnız kapalı iş seçiciden", () => {
    const route = read("src/app/api/cron/insight-engine/route.ts");
    expect(route).toMatch(/import \{ authorizeCron \} from "@\/lib\/cron-auth"/);
    expect(route).toMatch(/authorizeCron\(req\)/);
    expect(route).toMatch(/recordHeartbeat\(\s*"insight-engine"/);
    expect(route).toContain("export const maxDuration = 300;");
    expect(route).toContain('runBillingReconciliation(0, "insight_engine")');
    expect(route).not.toMatch(/createAdminClient\(/);
    expect(route).toMatch(/s\.remaining/); // kalan iş detayı heartbeat'e yazılır
  });

  it("reconciliation: insight_engine modunda mutabakat ATLANIR (para hareketi yok) ve createAdminClient çağrı sayısı artmadı", () => {
    const rec = read("src/lib/billing/reconciliation.ts");
    const i = rec.indexOf('if (job === "insight_engine") {');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(rec.indexOf('admin.rpc("claim_billing_payment_captures"'));
    expect(i).toBeLessThan(rec.indexOf('admin.rpc("expire_stale_billing_checkouts"'));
    // reconcileCapture + transitionCapture + runBillingReconciliation (allowlist ile aynı; artmadı)
    expect(rec.match(/createAdminClient\(\)/g)?.length).toBe(3);
  });

  it("insights klasörleri ve action service_role istemcisi OLUŞTURMAZ; allowlist'te insight girdisi yok", () => {
    for (const f of [
      "src/lib/insights/engine.ts",
      "src/lib/insights/store.ts",
      "src/lib/insights/facts.ts",
      "src/lib/insights/read.ts",
      "src/lib/insights/settings.ts",
      "src/app/actions/insights.ts",
      "src/lib/ai/insight-narrative.ts",
      "src/lib/ai/auto-call-gate.ts",
    ]) {
      expect(read(f), f).not.toMatch(/createAdminClient\(/);
    }
    expect(read("src/lib/admin-client-allowlist.ts")).not.toMatch(/insight/i);
  });
});

describe("kapılar ve bildirim", () => {
  it("action'ların her export'u requirePermission ile başlar", () => {
    const src = read("src/app/actions/insights.ts");
    const exported = src.match(/export async function \w+/g) ?? [];
    expect(exported.length).toBe(3);
    expect(src.match(/await requirePermission\(/g)?.length).toBe(3);
    expect(src).toContain('requirePermission("tasks", "create")');
  });

  it("bildirim tercihi 'insight': notify.ts + prefs UI + action DEFAULTS üçlüsü", () => {
    expect(read("src/lib/notify.ts")).toMatch(/\|\s*"insight"/);
    expect(read("src/components/app/notification-prefs.tsx")).toMatch(/key: "insight"/);
    expect(read("src/components/app/notification-prefs.tsx")).toMatch(/insight: boolean;/);
    expect(read("src/app/actions/notification-prefs.ts")).toMatch(/insight: true,/);
    expect(read("src/app/actions/notification-prefs.ts")).toMatch(/insight: prefs\.insight !== false/);
  });

  it("yüksek şiddet zile notifyTenant ile, dedupe_key taşıyarak ve günlük üst sınırla düşer", () => {
    const rec = read("src/lib/billing/reconciliation.ts");
    expect(rec).toContain('prefKey: "insight"');
    expect(rec).toContain("dedupeKey: n.dedupeKey");
    const engine = read("src/lib/insights/engine.ts");
    expect(engine).toContain('row.severity !== "yuksek"');
    expect(engine).toContain("MAX_NOTIFY_PER_USER_PER_DAY");
    expect(read("src/lib/notify.ts")).toContain("dedupe_key: input.dedupeKey");
  });
});

describe("kapsam sınırı: ana ekran dosyalarına dokunulmadı", () => {
  it("page.tsx ve _home/** içgörü okuyucusunu/yerleşimi henüz içermiyor (yalnız bugun-ozet briefing audit)", () => {
    expect(existsSync(join(root, "src/app/app/page.tsx"))).toBe(true);
    expect(read("src/app/app/page.tsx")).not.toContain("getInsightsForUser");
    const bugun = read("src/app/app/_home/bugun-ozet.tsx");
    expect(bugun).toContain("generateBriefingSummary(items, { tenantId: ctx.tenantId, actorId: ctx.userId })");
    expect(bugun).not.toContain("getInsightsForUser");
  });
});
