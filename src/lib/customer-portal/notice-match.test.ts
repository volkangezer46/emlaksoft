import { describe, expect, it } from "vitest";
import { findStatementMatch } from "./notice-match";

const notice = { amount: 25000, createdDay: "2026-10-05", reference: null };
const line = (id: string, date: string, amount: number, description = "HAVALE") => ({ id, date, amount, description });

describe("kiracı Ödedim bildirimi -> ekstre satırı", () => {
  it("aynı tutar ve yakın tarih eşleşir", () => {
    const m = findStatementMatch(notice, [line("a", "2026-10-06", 25000)]);
    expect(m).toMatchObject({ confidence: "high" });
    expect(m?.line.id).toBe("a");
  });
  it("tutar farklıysa ya da tarih penceresi dışındaysa eşleşmez", () => {
    expect(findStatementMatch(notice, [line("a", "2026-10-06", 24999.99)])).toBeNull();
    expect(findStatementMatch(notice, [line("a", "2026-09-30", 25000)])).toBeNull();
    expect(findStatementMatch(notice, [line("a", "2026-10-25", 25000)])).toBeNull();
  });
  it("uzak tarih orta güven; en yakın tarih seçilir", () => {
    const m = findStatementMatch(notice, [line("far", "2026-10-15", 25000), line("near", "2026-10-12", 25000)]);
    expect(m?.line.id).toBe("near");
    expect(m?.confidence).toBe("medium");
  });
  it("dekont no açıklamada geçiyorsa öncelikli ve yüksek güven", () => {
    const m = findStatementMatch({ ...notice, reference: "Dekont 4471" }, [
      line("a", "2026-10-05", 25000, "BASKA KISI"),
      line("b", "2026-10-13", 25000, "FAST dekont 4471 kira"),
    ]);
    expect(m?.line.id).toBe("b");
    expect(m?.confidence).toBe("high");
  });
});
