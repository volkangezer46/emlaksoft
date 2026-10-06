import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildOwnerReportSms, buildOwnerWeeklyReport, lastFullWeek, ownerReportDedupeKey, periodLabel } from "./core";
import { buildRentStatement, showRentDeclarationReminder, statementYears } from "./rent-statement";

const facts = {
  showings: { total: 3, completed: 2 },
  offers: { newCount: 1, openCount: 2 },
  feedback: { answered: 2, avgScore: 7.5, reasons: [{ label: "Fiyat", count: 2 }, { label: "Hayır", count: 1 }] },
  views: { thisWeek: 120, prevWeek: 100 },
  liveListings: 2,
};

describe("malik haftalık raporu", () => {
  it("satırlar gerçek olgudan; çekince 'Hayır' hariç; vitrin 'yaklaşık' etiketli", () => {
    const r = buildOwnerWeeklyReport(facts, "29 Eyl – 5 Eki 2026");
    expect(r.empty).toBe(false);
    expect(r.lines.find((l) => l.key === "showings")?.value).toBe("3 randevu (2 tamamlandı)");
    expect(r.lines.find((l) => l.key === "feedback")?.hint).toBe("Öne çıkan çekince: Fiyat (2)");
    expect(r.lines.find((l) => l.key === "views")?.value).toMatch(/^yaklaşık/);
    expect(r.lines.find((l) => l.key === "views")?.hint).toBe("Önceki haftaya göre +%20");
  });

  it("veri yoksa sıfır gibi değil 'yok' yazar; vitrin sayacı okunamadıysa satır hiç yok", () => {
    const r = buildOwnerWeeklyReport(
      { showings: { total: 0, completed: 0 }, offers: { newCount: 0, openCount: 0 }, feedback: { answered: 0, avgScore: null, reasons: [] }, views: { thisWeek: null, prevWeek: null }, liveListings: 0 },
      "x",
    );
    expect(r.empty).toBe(true);
    expect(r.lines.some((l) => l.key === "views")).toBe(false);
    expect(r.lines.find((l) => l.key === "offers")?.value).toBe("Bu hafta yeni teklif yok");
  });

  it("hafta penceresi Pzt–Paz; etiket ve SMS kısa, kişisel veri yok", () => {
    // 2026-10-07 Çarşamba → geçen hafta 2026-09-28..2026-10-04
    expect(lastFullWeek("2026-10-07")).toEqual({ startDay: "2026-09-28", endDayExclusive: "2026-10-05", prevStartDay: "2026-09-21", endDayInclusive: "2026-10-04" });
    expect(lastFullWeek("2026-10-05").startDay).toBe("2026-09-28");
    expect(periodLabel("2026-09-28", "2026-10-04")).toBe("28 Eyl – 4 Eki 2026");
    const sms = buildOwnerReportSms("Örnek Gayrimenkul Danışmanlık Ltd Şti", "Moda 2+1 Deniz Manzaralı Daire", "https://emlaksoft.vercel.app/malik-portali/abc#haftalik-rapor");
    expect(sms.length).toBeLessThan(200);
    expect(ownerReportDedupeKey("t1", "2026-09-28")).toBe("owner-report:t1:2026-09-28");
  });
});

describe("malik kira ekstresi", () => {
  it("tahsilat ödeme ayına, gider tamamlanan bakıma yazılır; net = tahsilat − gider", () => {
    const s = buildRentStatement(
      2026,
      [
        { period: "2026-01-01", amount: 10000, status: "paid", paidAt: "2026-01-06T10:00:00Z" },
        { period: "2026-02-01", amount: 10000, status: "paid", paidAt: "2026-03-02T10:00:00Z" },
        { period: "2026-03-01", amount: 10000, status: "overdue", paidAt: null },
        { period: "2025-12-01", amount: 9000, status: "paid", paidAt: "2025-12-03T10:00:00Z" },
      ],
      [
        { title: "Kombi bakımı", cost: 1500, status: "done", createdAt: "2026-03-10T10:00:00Z" },
        { title: "Musluk", cost: 300, status: "open", createdAt: "2026-03-11T10:00:00Z" },
      ],
    );
    expect(s.totals).toEqual({ accrued: 30000, collected: 20000, expense: 1500, net: 18500, overdue: 10000 });
    expect(s.months[2]).toMatchObject({ month: "2026-03", collected: 10000, expense: 1500, net: 8500, overdue: 10000 });
    expect(s.expenses).toEqual([{ title: "Kombi bakımı", cost: 1500, date: "2026-03-10" }]);
    expect(s.hasData).toBe(true);
  });

  it("beyan hatırlatması yalnız Şubat-Mart; yıllar en çok 6", () => {
    expect(showRentDeclarationReminder("2027-03-05")).toBe(true);
    expect(showRentDeclarationReminder("2027-04-05")).toBe(false);
    expect(statementYears("2019-05-01", 2026)).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
    expect(statementYears(null, 2026)).toEqual([2026]);
  });

  it("ekstre ve beyan notu tutar/oran yazmaz", () => {
    const src = readFileSync("src/lib/owner-report/rent-statement.ts", "utf8");
    const note = src.slice(src.indexOf("RENT_DECLARATION_NOTE"));
    expect(note.slice(0, 400)).not.toMatch(/\d{2,}[.,]?\d*\s*(TL|₺)/);
  });
});
