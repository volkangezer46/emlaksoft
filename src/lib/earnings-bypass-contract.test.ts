import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("B1/B2 kazanç ve kapsam atlama yolları sözleşmesi", () => {
  it("anlaşma detayı: ofis geneli dışı roller yalnız kendi anlaşmasını açar; earnings_all yoksa komisyon/danışman gizli", () => {
    const src = read("src/app/app/anlasmalar/[id]/page.tsx");
    expect(src).toContain("hasOfficeWideDataScope(role) && deal.assigned_to !== userId");
    expect(src).toContain("canSeeAllEarnings(perms)");
    expect(src).toContain("earningsVisible");
    // komisyon sorgusu earningsVisible olmadan çalışmaz
    expect(src).toMatch(/earningsVisible\s*\?\s*supabase\s*\.from\("commissions"\)/);
  });

  it("teklif detayı (getOffer): ofis geneli dışı roller yalnız kendi teklifini okur", () => {
    const src = read("src/app/actions/offers.ts");
    expect(src).toContain("!hasOfficeWideDataScope(gate.role) && data.created_by !== gate.userId");
  });

  it("komisyon defteri: earnings_all yoksa inner join + assigned_to süzgeci", () => {
    const src = read("src/app/app/komisyon/page.tsx");
    expect(src).toContain('"deals!commissions_deal_id_fkey!inner"');
    expect(src).toContain('.eq("deal.assigned_to", userId)');
  });

  it("hedefler: başkasının cirosu earnings_all olmadan gizli", () => {
    const src = read("src/app/app/hedefler/page.tsx");
    expect(src).toContain("canSeeEarningsOf(ctx.perms, ctx.userId, profileId)");
    expect(src).toContain("revVisible");
    expect(src).toContain('.eq("deal.assigned_to", ctx.userId)');
  });

  it("dışa aktarma: komisyon ve denetim earnings_all olmadan kendi kapsamı (hızlı + tam akış)", () => {
    const quick = read("src/app/actions/export.ts");
    const full = read("src/lib/export-full.ts");
    expect(quick).toContain('!hasOfficeWideDataScope(gate.role) || !seeAll) q = q.eq("deal.assigned_to", gate.userId)');
    expect(quick).toContain('!hasOfficeWideDataScope(gate.role) || !seeAll) q = q.eq("actor_id", gate.userId)');
    expect(full).toContain('!hasOfficeWideDataScope(gate.role) || !gate.seeAllEarnings) q = q.eq("deal.assigned_to", gate.userId)');
    expect(full).toContain('!hasOfficeWideDataScope(gate.role) || !gate.seeAllEarnings) q = q.eq("actor_id", gate.userId)');
  });

  it("danisman-kpi: ciro sütunu showRevenue ile kapalı", () => {
    const src = read("src/app/app/danisman-kpi/page.tsx");
    expect(src).toContain("showRevenue(a.id)");
  });
});
