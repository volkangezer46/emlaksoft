import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadApprovalRules } from "@/lib/oversight/store";
import { isSurveyTaskLinkExpired, SURVEY_TASK_LINK_VALID_DAYS } from "@/lib/surveys/task-expiry";
import { requesterMayCloseOffice } from "@/lib/admin/office-closure";
import { isApprovalExemptRole } from "@/lib/team/assignable-roles";

/**
 * Guvenlik denetimi 3 — uygulama katmani duzeltmelerinin sozlesme testleri.
 * Kaynak duzeyi kontroller (kapi sirasi/varligi) + saf mantik.
 */
const src = (p: string) => readFileSync(p, "utf8");

function fakeClient(result: { data?: unknown; error?: { code?: string; message?: string } | null }): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("#4 oversight_settings okuma hatasi fail-open degil", () => {
  it("tablo yoksa varsayilan kapali kurallar", async () => {
    const rules = await loadApprovalRules(fakeClient({ error: { code: "42P01", message: 'relation "oversight_settings" does not exist' } }), "t");
    expect(Object.values(rules).every((r) => r.enabled === false)).toBe(true);
  });

  it("baska okuma hatasi firlatir (kapi error doner, islem durur)", async () => {
    await expect(loadApprovalRules(fakeClient({ error: { code: "57014", message: "statement timeout" } }), "t")).rejects.toThrow();
  });

  it("satir yoksa (ayar hic yazilmamis) varsayilan kapali", async () => {
    const rules = await loadApprovalRules(fakeClient({ data: null }), "t");
    expect(rules.listing_delete.enabled).toBe(false);
  });
});

describe("#3 atomik tuketim (kaynak)", () => {
  const store = src("src/lib/oversight/approval-store.ts");
  it("consumed_at kosullu guncelleme + sutun yoksa guvenli dusus + denetim sonucu kontrolu", () => {
    expect(store).toMatch(/\.is\("consumed_at", null\)/);
    expect(store).toMatch(/\.update\(\{ consumed_at:/);
    expect(store).toContain("isMissingColumn(upd.error)");
    expect(store).toMatch(/return log\.ok;/);
    expect(store).toMatch(/length !== 1\) return false/);
  });
});

describe("#5 yonetici muafiyeti dar", () => {
  it("yalniz owner/gm muaf; branch_manager ve team_lead talep acar", () => {
    for (const r of ["branch_manager", "team_lead", "advisor", "accounting", "readonly"]) expect(isApprovalExemptRole(r)).toBe(false);
    for (const r of ["owner", "gm"]) expect(isApprovalExemptRole(r)).toBe(true);
  });

  it("depo muafiyeti isApprovalExemptRole ile verir, MANAGEMENT_TIER / ofis geneli kapsam ile degil", () => {
    const s = src("src/lib/oversight/approval-store.ts");
    expect(s).toContain("return isApprovalExemptRole(data?.role)");
    expect(s).not.toMatch(/hasOfficeWideDataScope/);
    expect(s).not.toMatch(/isApprovalDeciderRole/);
    expect(s).toMatch(/YALNIZ UYGULAMA KATMANIDIR/);
  });

  it("toplu arsive alma listing_delete kapisindan gecer, rpc'den ONCE", () => {
    const s = src("src/app/actions/bulk-property.ts");
    const gate = s.indexOf('requestApprovalIfNeeded(gate.tenantId, gate.userId, "listing_delete"');
    expect(gate).toBeGreaterThan(-1);
    expect(s.indexOf('newStatus === "archived"')).toBeLessThan(gate);
    expect(gate).toBeLessThan(s.indexOf("transition_property_status_atomic"));
    expect(s).toMatch(/approval\.status !== "not_required" && approval\.status !== "approved"/);
  });
});

describe("#2 export kanali", () => {
  it("hizli ve tam export farkli kanal gonderir", () => {
    expect(src("src/app/actions/export.ts")).toContain('channel: "quick"');
    expect(src("src/app/api/export/[entity]/route.ts")).toContain('channel: "full"');
  });
});

describe("#9 kapanis indirme kapisi", () => {
  it("rota reddedilmemis degil, tamamlanmis talep ister (closureDownloadAllowed)", () => {
    const s = src("src/lib/admin/office-closure.ts");
    expect(s).toMatch(/s === "completed"/);
    expect(s).not.toMatch(/s !== "rejected"/);
  });
});

describe("#8 talebi acan dogrulamasi", () => {
  it("yalniz hala aktif owner/gm ve ayni ofis", () => {
    expect(requesterMayCloseOffice({ role: "owner", is_active: true, tenant_id: "t1" }, "t1")).toBe(true);
    expect(requesterMayCloseOffice({ role: "gm", is_active: true, tenant_id: "t1" }, "t1")).toBe(true);
    expect(requesterMayCloseOffice({ role: "owner", is_active: false, tenant_id: "t1" }, "t1")).toBe(false);
    expect(requesterMayCloseOffice({ role: "advisor", is_active: true, tenant_id: "t1" }, "t1")).toBe(false);
    expect(requesterMayCloseOffice({ role: "owner", is_active: true, tenant_id: "t2" }, "t1")).toBe(false);
    expect(requesterMayCloseOffice(null, "t1")).toBe(false);
  });

  it("islem arsivlemeden ONCE dogrulanir; admin karti talebi acani gosterir", () => {
    const s = src("src/app/actions/platform-tenant-closure.ts");
    expect(s.indexOf("requesterMayCloseOffice(requester, tenantId)")).toBeGreaterThan(-1);
    expect(s.indexOf("requesterMayCloseOffice(requester, tenantId)")).toBeLessThan(s.indexOf("setTenantLifecycleByAdmin(archiveForm)"));
    expect(src("src/app/admin/tenants/[id]/office-management.tsx")).toContain("Talebi açan:");
    expect(src("src/lib/admin/office-management.ts")).toContain("created_by");
  });
});

describe("#10 vitrin kapaliyken tum public yuzeyler kapali", () => {
  const surfaces = [
    "src/app/vitrin/[slug]/[id]/page.tsx",
    "src/app/vitrin/[slug]/degerleme/page.tsx",
    "src/app/vitrin/[slug]/favoriler/page.tsx",
    "src/app/vitrin/[slug]/opengraph-image.tsx",
    "src/app/vitrin/[slug]/[id]/opengraph-image.tsx",
    "src/app/actions/vitrin.ts",
    "src/app/actions/vitrin-alerts.ts",
    "src/app/actions/public-valuation.ts",
    "src/app/api/vitrin-favoriler/route.ts",
  ];
  it.each(surfaces)("%s isVitrinEnabled denetler", (f) => {
    expect(src(f)).toContain("isVitrinEnabled(admin, tenant.id)");
  });

  it("sitemap kapali vitrini disarida birakir; sutun yokken geri uyumlu; danisman is_sample=false", () => {
    const s = src("src/lib/seo/sitemap-data.ts");
    expect(s).toContain('.eq("vitrin_enabled", false)');
    expect(s).toContain("closedRes.error ? []");
    expect(s).toContain("vitrinClosedIds.has(String(t.id))");
    expect(s).toMatch(/\.eq\("is_public", true\)\s*\.eq\("is_active", true\)\s*\.eq\("is_sample", false\)/);
  });
});

describe("#12 anket gorev token'i", () => {
  const DAY = 86_400_000;
  const due = "2026-09-01T00:00:00Z";
  const dueMs = Date.parse(due);
  it("due_at + 30 gunden sonra kapanir", () => {
    expect(SURVEY_TASK_LINK_VALID_DAYS).toBe(30);
    expect(isSurveyTaskLinkExpired(due, dueMs + 29 * DAY)).toBe(false);
    expect(isSurveyTaskLinkExpired(due, dueMs + 31 * DAY)).toBe(true);
    expect(isSurveyTaskLinkExpired(due, dueMs + 5 * DAY, 3)).toBe(true);
  });
  it("due_at yok/bozuk ise sure siniri uygulanmaz", () => {
    expect(isSurveyTaskLinkExpired(null, dueMs + 900 * DAY)).toBe(false);
    expect(isSurveyTaskLinkExpired("bozuk", dueMs + 900 * DAY)).toBe(false);
  });
  it("action sure + ornek ilan kontrolu yapar; sayfa da sureyi uygular", () => {
    const a = src("src/app/actions/survey-public.ts");
    expect(a).toContain("isSurveyTaskLinkExpired(task.due_at as string | null, now())");
    expect(a).toMatch(/from\("properties"\)[\s\S]{0,200}\.eq\("is_sample", false\)/);
    expect(src("src/app/anket/[token]/page.tsx")).toContain("isSurveyTaskLinkExpired(task.due_at");
  });
});
