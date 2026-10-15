import { describe, expect, it } from "vitest";
import {
  aggregateConvertOutcomes,
  classifyConvertOutcome,
  formatBulkConvertSummary,
  openHouseThankYouMessage,
} from "./open-house-bulk";

describe("aggregateConvertOutcomes", () => {
  it("boş listede tüm sayaçlar sıfır", () => {
    expect(aggregateConvertOutcomes([])).toEqual({ created: 0, linked: 0, skipped: 0, failed: 0 });
  });

  it("RPC sonuçlarını kovalara toplar", () => {
    const counts = aggregateConvertOutcomes([
      { outcome: "created", customer_id: "c1" },
      { outcome: "created", customer_id: "c2" },
      { outcome: "linked", customer_id: "c3" },
      { outcome: "replay", customer_id: "c4" },
      { outcome: "invalid_visitor" },
      { outcome: "not_found" },
      null,
      { outcome: "invalid_input" },
    ]);
    expect(counts).toEqual({ created: 2, linked: 1, skipped: 3, failed: 2 });
  });

  it("customer_id olmayan başarı sonucu başarısız sayılır", () => {
    expect(classifyConvertOutcome({ outcome: "created" })).toBe("failed");
    expect(classifyConvertOutcome({ outcome: "linked", customer_id: null })).toBe("failed");
  });

  it("tekrar çalıştırma (replay) idempotent olarak atlanır", () => {
    expect(classifyConvertOutcome({ outcome: "replay", customer_id: "c1" })).toBe("skipped");
  });
});

describe("formatBulkConvertSummary", () => {
  it("sıfır kovaları yazmaz", () => {
    expect(formatBulkConvertSummary({ created: 2, linked: 0, skipped: 1, failed: 0 })).toBe("2 yeni müşteri, 1 atlandı");
  });
  it("hiçbiri yoksa bilgi mesajı döner", () => {
    expect(formatBulkConvertSummary({ created: 0, linked: 0, skipped: 0, failed: 0 })).toBe("Dönüştürülecek ziyaretçi yok");
  });
});

describe("openHouseThankYouMessage", () => {
  it("ilk adı ve mülkü kullanır", () => {
    const msg = openHouseThankYouMessage("  Ayşe Yılmaz ", "Moda 3+1");
    expect(msg.startsWith("Merhaba Ayşe, Moda 3+1 için düzenlediğimiz açık eve")).toBe(true);
  });
  it("ad ve mülk yoksa genel selamlama", () => {
    expect(openHouseThankYouMessage(null, null).startsWith("Merhaba, düzenlediğimiz açık eve")).toBe(true);
  });
});
