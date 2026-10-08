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
    // Gerçekleşme tek kaynaktan: komisyon okuma kapısı advisor-metrics içindedir.
    expect(src).toContain("loadTargetActualsLive");
    expect(src).toContain("revVisible");
    const lib = read("src/lib/team/advisor-metrics.ts");
    expect(lib).toContain('.eq("deal.assigned_to", opts.viewerId)');
    expect(lib).toContain("const visible = t.profile_id ? seeAll || t.profile_id === viewer.userId : seeAll;");
  });

  it("dışa aktarma: komisyon, komisyon ödemesi ve denetim raporları earnings_all olmadan kendi kapsamı (rapor merkezi)", () => {
    const sales = read("src/lib/report-center/catalog/tenant-sales.ts");
    const team = read("src/lib/report-center/catalog/tenant-team.ts");
    const helpers = read("src/lib/report-center/query-helpers.ts");
    // Kazanç raporları kapsam yardımcısına `earnings: true` ile bağlıdır.
    expect(sales).toContain('actorColumn: "deal.assigned_to", earnings: true');
    expect(sales).toContain('actorColumn: "profile_id", earnings: true');
    expect(team).toContain('actorColumn: "actor_id", earnings: true');
    // Yardımcı: ofis geneli kapsam YA DA earnings_all yoksa yalnız kendi kayıtları.
    expect(helpers).toContain("!ctx.officeWide || (opts.earnings && !ctx.seeAllEarnings)");
    // Kâr/zarar yalnız earnings_all sahibine açılır.
    expect(read("src/lib/report-center/registry.ts")).toContain("def.earningsAllOnly && !v.seeAllEarnings");
  });

  it("danisman-kpi: ciro sütunu showRevenue ile kapalı", () => {
    const src = read("src/app/app/danisman-kpi/page.tsx");
    expect(src).toContain("showRevenue(a.id)");
  });

  it("metrik tek kaynağı: yetkisiz rolde komisyon satırı yalnız kendi anlaşması/payı için çekilir, ofis brüt toplamı earnings_all ister", () => {
    const lib = read("src/lib/team/advisor-metrics.ts");
    expect(lib).toContain("if (opts.seeAll)");
    expect(lib).toContain('.contains("splits", [{ profile_id: opts.viewerId }])');
    expect(lib).toContain("const gross = seeAllEarnings ? officeGross(facts.commissions, period) : null;");
    expect(lib).toContain("const canSee = (id: string) => seeAllEarnings || id === viewerId;");
  });

  it("danışman ekranları tek kaynaktan beslenir: kendi RPC/toplama sorgusu yazmaz", () => {
    for (const p of [
      "src/app/app/danisman-kpi/page.tsx",
      "src/app/app/ekip/kiyas/page.tsx",
      "src/lib/tv/tv-data.ts",
      "src/app/app/lig/page.tsx",
      "src/app/app/ekip/[id]/advisor-view.tsx",
    ]) {
      const src = read(p);
      expect(src, p).toContain("loadAdvisorMetrics");
      expect(src, p).not.toContain('rpc("advisor_kpis"');
    }
    expect(read("src/app/app/ekip/[id]/advisor-data.ts")).toContain("loadAdvisorMetrics");
    expect(read("src/app/app/cuzdan/office-earnings.tsx")).toContain("loadAdvisorMetrics");
  });
});
