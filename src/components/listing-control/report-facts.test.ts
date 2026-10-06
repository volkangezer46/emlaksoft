import { describe, expect, it } from "vitest";
import { acceptNarrative } from "@/lib/ai/narrative-guard";
import { buildReportFacts, factsToPromptInput, ruleBasedSummary } from "./report-facts";
import { emptySummary } from "./helpers";

const summary = { ...emptySummary(), total_active: 40, healthy: 30, portal_missing: 3, in_review: 2, awaiting_publish: 4 };
const changes = { anomalies_opened: 5, anomalies_closed: 2, newly_missing: 3, recovered: 1, checks_total: 80, checks_unverifiable: 6 };

describe("rapor olguları", () => {
  it("her olgunun tıklanabilir hedefi vardır (sıfır çıkmaz metrik)", () => {
    for (const f of buildReportFacts(summary, changes)) expect(f.href.startsWith("/app/")).toBe(true);
  });
  it("değişim verisi yoksa değişim olguları üretilmez (uydurma yok)", () => {
    const keys = buildReportFacts(summary, null).map((f) => f.key);
    expect(keys).not.toContain("anomalies_opened");
    expect(keys).toContain("total_active");
  });
  it("aktif portföy yoksa yüzde olgusu yok", () => {
    expect(buildReportFacts(emptySummary(), null).map((f) => f.key)).not.toContain("healthy_percent");
  });
  it("kural özeti yalnız olgulardaki sayıları kullanır", () => {
    const facts = buildReportFacts(summary, changes);
    const input = factsToPromptInput("day", "manager", facts);
    for (const line of ruleBasedSummary("day", facts)) expect(acceptNarrative(line, input, { maxWords: 40 })).not.toBeNull();
  });
  it("AI çıktısında olgularda olmayan sayı reddedilir", () => {
    const input = factsToPromptInput("week", "advisor", buildReportFacts(summary, changes));
    expect(acceptNarrative("Portalda 3 ilan kayıp; ilk bunlara bakın.", input, { maxWords: 40 })).not.toBeNull();
    expect(acceptNarrative("Portalda 17 ilan kayıp.", input, { maxWords: 40 })).toBeNull();
  });
  it("aktif portföy yoksa kural özeti sade", () => {
    expect(ruleBasedSummary("day", buildReportFacts(emptySummary(), null))).toEqual(["Kontrol kapsamında aktif portföy yok."]);
  });
});
