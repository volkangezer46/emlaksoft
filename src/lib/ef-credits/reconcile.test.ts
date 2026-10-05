import { describe, expect, it } from "vitest";
import { compareReconciliation, countCommittedByItem, describeReconciliation } from "./reconcile";

describe("ef reconcile", () => {
  it("yalniz committed ve ilgili kalemleri sayar", () => {
    const rows = [
      { item: "valuation_arsa", state: "committed" },
      { item: "valuation_konut", state: "committed" },
      { item: "valuation_arsa", state: "released" },
      { item: "pdf_first", state: "committed" },
      { item: "pdf_first", state: "reserved" },
      { item: "report_detail", state: "committed" },
    ];
    expect(countCommittedByItem(rows)).toEqual({ degerleme: 2, pdf: 1 });
  });

  it("tolerans icinde ok", () => {
    const r = compareReconciliation({ degerleme: 10, pdf: 4 }, { degerleme: 9, pdf: 4 });
    expect(r.status).toBe("ok");
    expect(r.diffDegerleme).toBe(1);
  });

  it("tolerans asilinca drift ve isaretli fark", () => {
    const r = compareReconciliation({ degerleme: 10, pdf: 1 }, { degerleme: 10, pdf: 5 });
    expect(r.status).toBe("drift");
    expect(r.diffPdf).toBe(-4);
    expect(describeReconciliation(r)).toContain("pdf farki -4");
  });

  it("ozel tolerans uygulanir; gecersiz tolerans varsayilana duser", () => {
    expect(compareReconciliation({ degerleme: 10, pdf: 0 }, { degerleme: 5, pdf: 0 }, { tolerance: 5 }).status).toBe("ok");
    expect(compareReconciliation({ degerleme: 10, pdf: 0 }, { degerleme: 5, pdf: 0 }, { tolerance: -1 }).status).toBe("drift");
  });

  it("EF verisi eksikse error (sessizce ok degil)", () => {
    const r = compareReconciliation({ degerleme: null, pdf: 0 }, { degerleme: 0, pdf: 0 });
    expect(r.status).toBe("error");
    expect(r.diffDegerleme).toBeNull();
  });
});
