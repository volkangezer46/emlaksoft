import { describe, expect, it } from "vitest";
import { gradeOf, measureHealth, type HealthInput } from "./health";

const OK: HealthInput = {
  tableMissing: false,
  pageviewsEnabled: true,
  flowLast24h: true,
  coverage: { signups: 10, attributed: 9 },
  attributionEnabled: true,
  bufferError: null,
};

describe("ölçüm sağlığı notu", () => {
  it("sorun yoksa A ve bulgu yok", () => {
    expect(measureHealth(OK)).toEqual({ score: 100, grade: "A", findings: [] });
  });

  it("tablo yoksa doğrudan F ve tek kritik bulgu", () => {
    const r = measureHealth({ ...OK, tableMissing: true });
    expect(r.grade).toBe("F");
    expect(r.findings.map((f) => f.code)).toEqual(["olcum-tablo-yok"]);
  });

  it("24 saatte akış yok → kritik; bilinmiyorsa (null) puan düşmez", () => {
    expect(measureHealth({ ...OK, flowLast24h: false }).findings[0]!.severity).toBe("kritik");
    expect(measureHealth({ ...OK, flowLast24h: false }).grade).toBe("C");
    expect(measureHealth({ ...OK, flowLast24h: null }).grade).toBe("A");
  });

  it("atıf kapsama < %80 → uyarı (atıf açık); kapalıyken yalnız bilgi", () => {
    const low = { signups: 10, attributed: 5 };
    const on = measureHealth({ ...OK, coverage: low });
    expect(on.findings[0]).toMatchObject({ code: "olcum-atif-kapsama", severity: "uyari" });
    expect(on.findings[0]!.text).toContain("%50");
    expect(on.grade).toBe("B");
    const off = measureHealth({ ...OK, coverage: low, attributionEnabled: false });
    expect(off.findings[0]).toMatchObject({ code: "olcum-atif-kapali", severity: "bilgi" });
    expect(off.grade).toBe("A");
  });

  it("az örnekle (5'ten az kayıt) kapsama yorumlanmaz; kayıt yoksa uydurma yok", () => {
    expect(measureHealth({ ...OK, coverage: { signups: 3, attributed: 0 } }).findings).toEqual([]);
    expect(measureHealth({ ...OK, coverage: null }).findings).toEqual([]);
  });

  it("tampon hatası → uyarı; birden çok bulgu birikir, taban 0", () => {
    const r = measureHealth({ ...OK, bufferError: "x", flowLast24h: false, coverage: { signups: 10, attributed: 0 } });
    expect(r.findings.map((f) => f.severity).sort()).toEqual(["kritik", "uyari", "uyari"]);
    expect(r.score).toBe(20);
    expect(r.grade).toBe("F");
    for (const f of r.findings) {
      expect(f.text).not.toMatch(/LCP|INP|beacon|RPC|migration/i); // teknik olmayan cümle
      expect(f.href.startsWith("/admin/")).toBe(true);
    }
  });

  it("not eşikleri", () => {
    expect([100, 90, 89, 75, 74, 60, 59, 45, 44, 30, 29, 0].map(gradeOf)).toEqual(["A", "A", "B", "B", "C", "C", "D", "D", "E", "E", "F", "F"]);
  });
});
