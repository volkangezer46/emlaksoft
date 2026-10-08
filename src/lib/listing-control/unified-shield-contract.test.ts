import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRATION_GROUP_SPEC } from "../../../scripts/migration-pairs-data";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { propertiesToSync } from "./server/events";

/**
 * SÖZLEŞME (statik): İlan Kontrol ile Kayıp-Kaçak Kalkanı TEK sistem; tarayıcı işçisi kullanıcı JWT'siyle çalışır
 * (admin client yok); olay günlüğü + Realtime; SLA zinciri leak-sla cron'unda (yeni cron yok).
 */
const ROOT = process.cwd();
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIG = "supabase/migrations/20260826002800_lc_worker_events_realtime.sql";

describe("migration 20260826002800", () => {
  const t = src(MIG);
  it("forward-only başlık, ön-koşul bloğu, lock_timeout ve rollback", () => {
    expect(t).toMatch(/UYGULANMADI/);
    expect(t).toMatch(/do \$\$[\s\S]*?raise exception/i);
    expect(t).toMatch(/set local lock_timeout/);
    expect(src("supabase/rollbacks/20260826002800_lc_worker_events_realtime.rollback.sql")).toContain("drop table if exists public.listing_control_events");
  });
  it("pairs verisinde benzersiz pencere (PB33, P12'den önce) ve etki sınıfı", () => {
    const f = "20260826002800_lc_worker_events_realtime.sql";
    expect(MIGRATION_GROUP_SPEC.impact[f]).toBeDefined();
    const w = MIGRATION_GROUP_SPEC.windows.find((x) => x.files.includes(f));
    expect(w?.id.startsWith("PB33")).toBe(true);
    const p12 = MIGRATION_GROUP_SPEC.windows.find((x) => x.id.startsWith("P12"));
    expect(w!.order).toBeLessThan(p12!.order);
    expect(MIGRATION_GROUP_SPEC.windows.filter((x) => x.files.includes(f))).toHaveLength(1);
  });
  it("worker RPC'leri yalnız authenticated'a açık, anon yok; JWT'den ofis/kullanıcı", () => {
    for (const fn of ["lc_worker_register", "lc_worker_claim", "lc_worker_complete", "lc_worker_release"]) {
      expect(t, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`));
      expect(t, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`));
      expect(t, fn).not.toMatch(new RegExp(`grant execute on function public\\.${fn}[^;]*service_role`));
    }
    expect(t).toContain("public.current_tenant_id()");
    expect(t).toContain("auth.uid()");
    expect(t).toContain("has_effective_permission('portals', 'edit')");
  });
  it("olay tablosu: RLS + rol kapsamı + yalnız select; Realtime yayını; kapanış ve teyit tetikleyicileri", () => {
    expect(t).toMatch(/alter table public\.listing_control_events enable row level security/);
    expect(t).toContain("lc_row_visible(branch_id, team_id, advisor_id)");
    expect(t).toMatch(/grant select on table public\.listing_control_events to authenticated/);
    expect(t).not.toMatch(/grant (all|insert|update|delete)[^;]*listing_control_events[^;]*to authenticated/);
    expect(t).toContain("alter publication supabase_realtime add table public.listing_control_events");
    expect(t).toContain("trg_lc_closure_event");
    expect(t).toContain("'closure_recorded'");
    expect(t).toContain("'listing_confirmed'");
  });
  it("alarm sogutmasi: cozulen 24 saat, otomatik kapanan 2 saat; false_positive yeniden acilmaz", () => {
    expect(t).toContain("interval '24 hours'");
    expect(t).toContain("interval '2 hours'");
    expect(t).toMatch(/elsif a\.status = 'false_positive'/);
  });
});

describe("istemci/sunucu sınırları", () => {
  it("worker eylemleri admin client kullanmaz; her eylem requirePermission ile başlar", () => {
    const a = src("src/app/actions/listing-control-worker.ts");
    expect(a).not.toMatch(/createAdminClient|supabase\/admin/);
    expect(a.match(/requirePermission\("portals", "edit"\)/g)?.length).toBe(5); // register/claim/complete/release + ayrıştırıcı telemetrisi
    expect(src("src/app/actions/listing-control-report.ts")).not.toMatch(/createAdminClient|supabase\/admin/);
  });
  it("çekirdek ve köprü portala sunucudan istek atmaz", () => {
    for (const f of ["src/lib/listing-control/worker/core.ts", "src/lib/listing-control/worker/bridge.ts", "src/app/actions/listing-control-worker.ts"]) {
      expect(src(f), f).not.toMatch(/\bfetch\s*\(|fetchExternal|axios/);
    }
  });
  it("AI özeti yalnız openai-client üzerinden, audit zorunlu, çıktı doğrulanır", () => {
    const s = src("src/lib/ai/listing-control-summary.ts");
    expect(s).toContain("openAiChat(");
    expect(s).not.toContain("api.openai.com");
    expect(s).toMatch(/\baudit,/);
    expect(s).toContain("acceptNarrative(");
    expect(s).toMatch(/UYDURMA/);
  });
  it("ilan kontrol düzeni canlı yenileme + işçiyi yükler", () => {
    const l = src("src/app/app/ilan-kontrol/layout.tsx");
    expect(l).toContain("ControlLiveRefresh");
    expect(l).toContain("VerificationWorker");
    expect(l).toContain('requireModulePage("portals"');
    expect(src("src/components/listing-control/live-refresh.tsx")).toContain("listing_control_events");
  });
});

describe("tek sistem: Kalkan ile birleşik akış", () => {
  it("alt gezinme 'Kapanış kayıpları' sekmesi Kalkan yolunu gösterir; Kalkan sayfası aynı şeridi kullanır", () => {
    expect(src("src/components/listing-control/sub-nav.tsx")).toContain('"/app/kayip-kacak"');
    expect(src("src/app/app/kayip-kacak/page.tsx")).toContain('<ControlSubNav active="kapanis"');
  });
  it("Kalkan kapanış kaydı 'CRM'de kapanış var' sayılır (FK ipuçlu gömme)", () => {
    const s = src("src/lib/listing-control/server/sync.ts");
    expect(s).toContain("listing_closures");
    expect(s).toContain("portal_listings!listing_closures_portal_listing_id_fkey!inner(property_id)");
    expect(s).toContain("closedProps.has(p.id)");
  });
  it("SLA zinciri leak-sla cron'unda; havuz-atama adımında YOK; yeni cron yok; takvim iki yerde aynı", () => {
    expect(src("src/app/api/cron/leak-sla/route.ts")).toContain("runSlaEscalation");
    expect(src("src/lib/listing-control/server/cron-steps.ts")).not.toContain("runSlaEscalation(");
    const job = CRON_JOBS.find((j) => j.job === "leak-sla")!;
    const vercel = JSON.parse(src("vercel.json")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.find((c) => c.path === job.path)?.schedule).toBe(job.schedule);
    expect(vercel.crons).toHaveLength(CRON_JOBS.length);
    // Saatlik çalışır: 4 saatlik kademe en çok ~1 saat gecikir.
    expect(job.schedule).toBe("11 * * * *");
  });
  it("Kalkan teyit eylemi doğrulama günlüğüne de yazar (kullanıcı oturumuyla)", () => {
    const a = src("src/app/actions/portal-listings.ts");
    expect(a).toContain("lc_submit_manual_check");
    expect(a.match(/createAdminClient\s*\(/g)).toHaveLength(4);
  });
  it("ana ekran İlan sağlığı bloğu 'portalda kayıp' sayısını İlan Kontrol özetinden okur ve aynı bayrakla filtreli listeye bağlar", () => {
    const h = src("src/app/app/_home/ilan-sagligi.tsx");
    expect(h).toContain("getControlSummary");
    expect(h).toContain("kpiHref(k, group, groupId)");
    expect(h).toContain('href("portal_missing")');
  });
  it("olay tüketicisi: kapanış ve doğrulama olaylarını işler", () => {
    const rows = [
      { id: "1", tenant_id: "t", property_id: "p1", event_type: "closure_recorded" },
      { id: "2", tenant_id: "t", property_id: "p1", event_type: "check_state_changed" },
      { id: "3", tenant_id: "t", property_id: "p2", event_type: "listing_confirmed" },
      { id: "4", tenant_id: "t", property_id: "p3", event_type: "counters_changed" },
      { id: "5", tenant_id: "u", property_id: null, event_type: "closure_recorded" },
    ];
    const m = propertiesToSync(rows);
    expect(m.get("t")?.sort()).toEqual(["p1"]);
    expect(m.has("u")).toBe(false);
    expect(src("src/lib/listing-control/server/events.ts")).toContain('"listing_confirmed"');
  });
  it("createAdminClient kabul listesine ilan kontrol satırı eklenmedi (yeni dosya yok)", () => {
    const allow = src("src/lib/admin-client-allowlist.ts");
    for (const f of ["listing-control-worker", "listing-control-report", "listing-control/server/events"]) expect(allow).not.toContain(f);
  });
});
