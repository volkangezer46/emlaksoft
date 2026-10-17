import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { advisorShare, summarizeOwnShare, type ShareRow } from "@/lib/team/advisor-share";
import { currentMonthPeriod } from "@/lib/team/advisor-metrics";
import { lastSixMonthKeys, officeCommissionView } from "./helpers";

/**
 * F1 — ana ekran "Bu ay kazancım" = /app/kazancim "Bu ay payım" (aynı satırlar, aynı pay hesabı). Eskiden ana ekran brüt
 * komisyonu (`gross_amount`) topluyor ve split'te `profile_id` ile pay alan (anlaşması kendisine atanmamış) kişiyi hiç
 * görmüyordu. F4 — muhasebe (kişisel kazanç rolü değil) `earnings_all` ile ofis geneli komisyonu görür.
 */
const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const ME = "me-1";
const NOW = Date.parse("2026-10-17T11:00:00Z");

type Row = ShareRow & { created_at: string; id: string };
const rows: Row[] = [
  // Bu ay, bana atanmış, %50 kimlikli pay
  { id: "a", gross_amount: 256_000, status: "paid", created_at: "2026-10-07T09:00:00Z", deal: { assigned_to: ME }, splits: [{ label: "Danışman", rate: 50, profile_id: ME }, { label: "Ofis", rate: 50 }] },
  // Bu ay, bekleyen, paylaşım tanımsız → brüt
  { id: "b", gross_amount: 5_500, status: "calculated", created_at: "2026-10-06T09:00:00Z", deal: { assigned_to: ME }, splits: [] },
  // Bu ay, YALNIZ split (anlaşma başkasına atanmış) — eski ana ekran bunu hiç saymıyordu
  { id: "c", gross_amount: 100_000, status: "calculated", created_at: "2026-10-05T09:00:00Z", deal: { assigned_to: "baskasi" }, splits: [{ label: "Takım lideri", rate: 15, profile_id: ME }, { label: "Danışman", rate: 50, profile_id: "baskasi" }] },
  // Bu ay, başkasının (payım yok)
  { id: "d", gross_amount: 80_000, status: "paid", created_at: "2026-10-04T09:00:00Z", deal: { assigned_to: "baskasi" }, splits: [{ label: "Danışman", rate: 60, profile_id: "baskasi" }] },
  // Geçen ay, TR saatine göre ekim değil eylül (30 Eyl 20:59 UTC = 23:59 TR)
  { id: "e", gross_amount: 40_000, status: "paid", created_at: "2026-09-30T20:59:00Z", deal: { assigned_to: ME }, splits: [{ label: "Danışman", rate: 50, profile_id: ME }] },
  // Ay sınırı: 30 Eyl 21:00 UTC = 1 Eki 00:00 TR → EKİM
  { id: "f", gross_amount: 10_000, status: "paid", created_at: "2026-09-30T21:00:00Z", deal: { assigned_to: ME }, splits: [{ label: "Danışman", rate: 50, profile_id: ME }] },
];

/** /app/kazancim "Bu ay" tanımı: payı olan satırlardan bu TR ayında oluşanların pay toplamı (sayfa ile aynı aralık). */
function kazancimThisMonth(list: readonly Row[], fullName: string | null) {
  const period = currentMonthPeriod(NOW);
  return list
    .map((row) => ({ row, share: advisorShare(row, fullName, ME) }))
    .filter((x) => x.share && Date.parse(x.row.created_at) >= Date.parse(period.startIso) && Date.parse(x.row.created_at) < Date.parse(period.endIso))
    .reduce((t, x) => t + x.share!.amount, 0);
}

describe("F1 ana ekran kazancım = Kazancım payı", () => {
  it("bu ayın değeri Kazancım ile aynı (split-only satır dahil, brüt değil)", () => {
    const keys = lastSixMonthKeys(NOW);
    const home = summarizeOwnShare(rows, "Danışman", ME, keys);
    const thisMonth = home.monthTotals.at(-1)!;
    expect(thisMonth).toBe(kazancimThisMonth(rows, "Danışman"));
    // 128.000 (a) + 5.500 (b brüt) + 15.000 (c yalnız split) + 5.000 (f) = 153.500; brüt toplam (eski) 261.500 + ... değil
    expect(thisMonth).toBe(128_000 + 5_500 + 15_000 + 5_000);
    expect(home.monthTotals.at(-2)).toBe(20_000);
  });

  it("tahsil / bekleyen ayrımı paya göre", () => {
    const s = summarizeOwnShare(rows, "Danışman", ME, lastSixMonthKeys(NOW));
    expect(s.paid).toBe(128_000 + 20_000 + 5_000);
    expect(s.pending).toBe(5_500 + 15_000);
  });

  it("kod yolu: ana ekran kendi payını fetchCommissionRows + summarizeOwnShare ile okur; Kazancım aynı yardımcıyı kullanır", () => {
    const data = src("src/app/app/_home/data.ts");
    const own = data.slice(data.indexOf("export const loadOwnShareSummary"), data.indexOf("export const loadOwnShareSummary") + 900);
    expect(own).toContain("fetchCommissionRows(");
    expect(own).toContain("seeAll: false");
    expect(own).toContain("summarizeOwnShare(");
    expect(data).not.toMatch(/deal\.assigned_to", ctx\.userId\)[\s\S]{0,200}gross_amount/);
    const kaz = src("src/app/app/kazancim/page.tsx");
    expect(kaz).toContain("summarizeOwnShare(rows, fullName, userId");
    // "Hedefime kalan" ve takım lideri "Bu ay kazancım" kartları aynı KPI gelirini (loadKpiData.revenue → loadCommissionSummary) kullanır.
    const role = src("src/app/app/_home/kurumsal/role-data.ts");
    expect(role).toMatch(/case "hedefime-kalan"[\s\S]{0,400}k\.revenue\.thisMonth/);
  });
});

describe("F4 muhasebe ofis geneli komisyon görür", () => {
  it("officeCommissionView: muhasebe (earnings_all) kapsamdan bağımsız ofis; satış rolü 'Benim işlerim'de kendi payı", () => {
    expect(officeCommissionView({ seeAllEarnings: true, scopeMine: true, role: "accounting" })).toBe(true);
    expect(officeCommissionView({ seeAllEarnings: false, scopeMine: true, role: "accounting" })).toBe(false);
    expect(officeCommissionView({ seeAllEarnings: true, scopeMine: true, role: "owner" })).toBe(false);
    expect(officeCommissionView({ seeAllEarnings: true, scopeMine: false, role: "owner" })).toBe(true);
    expect(officeCommissionView({ seeAllEarnings: false, scopeMine: true, role: "advisor" })).toBe(false);
  });

  it("bekleyen komisyon yokken açıklama 'komisyon yok' demez", () => {
    const t = src("src/app/app/_home/tahsilat.tsx");
    expect(t).not.toContain("tahakkuk eden komisyon yok");
    expect(t).toContain("Bekleyen komisyon yok");
  });
});
