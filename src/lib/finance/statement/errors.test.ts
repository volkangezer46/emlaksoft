import { describe, expect, it } from "vitest";
import { explainApplyFailures, precheckStatementFile, statementTransportError } from "./errors";

describe("ekstre başarısızlık nedenleri", () => {
  it("boyut ve biçim: yüklemeden önce açık mesaj", () => {
    expect(precheckStatementFile({ name: "ekstre.csv", size: 1000 })).toBeNull();
    expect(precheckStatementFile({ name: "ekstre.xlsx", size: 1000 })).toBeNull();
    expect(precheckStatementFile({ name: "hareket.OFX", size: 10 })).toBeNull();
    expect(precheckStatementFile({ name: "ekstre.csv", size: 3 * 1024 * 1024 })).toContain("2 MB");
    expect(precheckStatementFile({ name: "ekstre.xls", size: 100 })).toContain(".xls");
    expect(precheckStatementFile({ name: "ekstre.pdf", size: 100 })).toContain("csv");
    expect(precheckStatementFile({ name: "ekstre.csv", size: 0 })).toContain("boş");
  });

  it("JSON olmayan platform yanıtı: bağlantı hatası değil, duruma göre neden", () => {
    expect(statementTransportError(413, null)).toContain("2 MB");
    expect(statementTransportError(504, null)).toContain("zamanında");
    expect(statementTransportError(500, null)).toContain("Sunucu");
    expect(statementTransportError(429, "Çok sık deneme.")).toBe("Çok sık deneme.");
  });

  it("onay sonrası reddedilen satırlar: açılış tarihi, gelecek tarih ve maaş yetkisi ayrı sayılır", () => {
    const lines = new Map([
      ["a", { date: "2026-01-01", direction: "out" as const }],
      ["b", { date: "2026-12-31", direction: "out" as const }],
      ["c", { date: "2026-10-01", direction: "out" as const }],
      ["d", { date: "2026-10-02", direction: "out" as const }],
    ]);
    const base = {
      decisions: [
        { lineId: "a", action: "create" },
        { lineId: "b", action: "create" },
        { lineId: "c", action: "create", category: "maas" },
        { lineId: "d", action: "skip" },
      ],
      lines,
      openingDate: "2026-06-01",
      today: "2026-10-11",
      canBookSalary: false,
      isOfficeAccount: true,
    };
    const text = explainApplyFailures(base, 3);
    expect(text).toContain("3 satır işlenemedi");
    expect(text).toContain("1 satırın tarihi hesabın açılış tarihinden önce");
    expect(text).toContain("1 satırın tarihi bugünden sonra");
    expect(text).toContain("maaş");
    expect(explainApplyFailures({ ...base, canBookSalary: true }, 2)).not.toContain("maaş");
    expect(explainApplyFailures({ ...base, decisions: [] }, 1)).toContain("kategori, yetki");
  });
});
