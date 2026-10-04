import { describe, expect, it } from "vitest";
import { closureDownloadAllowed, isClosureRequestType, planClosure } from "@/lib/admin/office-closure";

describe("planClosure", () => {
  it("hesap kapatma aktif ofisi arşivler", () => {
    expect(planClosure("account_closure", "active", "").archive).toBe(true);
  });
  it("arşivdeki ofis tekrar arşivlenmez (idempotent)", () => {
    expect(planClosure("account_closure", "cancelled", "").archive).toBe(false);
  });
  it("veri indirme talebi ofisi kapatmaz", () => {
    const p = planClosure("data_export", "active", "teslim edildi");
    expect(p.archive).toBe(false);
    expect(p.resolution).toContain("teslim edildi");
  });
  it("çözüm notu 1000 karakteri aşmaz", () => {
    expect(planClosure("account_closure", "active", "x".repeat(2000)).resolution.length).toBeLessThanOrEqual(1000);
  });
});

describe("closureDownloadAllowed", () => {
  it("yalnız arşivdeki ofiste ve platformun tamamladığı talep varken izin verir", () => {
    expect(closureDownloadAllowed("cancelled", ["completed"])).toBe(true);
    expect(closureDownloadAllowed("cancelled", ["rejected"])).toBe(false);
    expect(closureDownloadAllowed("cancelled", ["open"])).toBe(false);
    expect(closureDownloadAllowed("cancelled", ["in_progress", "rejected"])).toBe(false);
    expect(closureDownloadAllowed("cancelled", ["open", "completed"])).toBe(true);
    expect(closureDownloadAllowed("cancelled", [])).toBe(false);
    expect(closureDownloadAllowed("active", ["open"])).toBe(false);
    expect(closureDownloadAllowed(null, ["open"])).toBe(false);
  });
});

describe("isClosureRequestType", () => {
  it("yalnız ofis düzeyi türleri kabul eder", () => {
    expect(isClosureRequestType("account_closure")).toBe(true);
    expect(isClosureRequestType("erasure")).toBe(false);
  });
});
