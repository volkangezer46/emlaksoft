import { describe, expect, it } from "vitest";
import type { ScanStatusView } from "./extension-status-view";
import { hasReadResult, scanBaseline, scanProgressText, scanRunState } from "./scan-run-view";

const portal = (id: string, over: Partial<ScanStatusView["portals"][number]> = {}) => ({ id, lastFullAt: null, lastTryAt: null, lastResult: null, lastRead: 0, lastExpected: null, ...over });
const view = (over: Partial<ScanStatusView> = {}): ScanStatusView => ({ lastFullAt: null, active: false, activePortal: null, pendingUploads: 0, portals: [portal("sahibinden")], ...over });

describe("scanProgressText", () => {
  it("sayfa sayısı ve toplam tahmini", () => {
    expect(scanProgressText(view({ active: true, activePages: 3, activeRead: 60, activeExpected: 100 }))).toBe("İlanların okunuyor… 3/5 sayfa");
  });
  it("toplam bilinmiyorsa yalnız okunan sayfa; hiç sayfa yoksa yalın metin", () => {
    expect(scanProgressText(view({ active: true, activePages: 2, activeRead: 40, activeExpected: null }))).toBe("İlanların okunuyor… 2. sayfa");
    expect(scanProgressText(view({ active: true }))).toBe("İlanların okunuyor…");
    expect(scanProgressText(null)).toBe("İlanların okunuyor…");
  });
  it("tahmin okunan sayfayı aşmaz (3/3)", () => {
    expect(scanProgressText(view({ active: true, activePages: 3, activeRead: 60, activeExpected: 10 }))).toBe("İlanların okunuyor… 3/3 sayfa");
  });
});

describe("scanRunState", () => {
  it("başlangıçtan sonra denenmediyse idle (eski sonuç bu koşuya sayılmaz)", () => {
    const old = view({ portals: [portal("sahibinden", { lastTryAt: 100, lastResult: "complete", lastRead: 5 })] });
    expect(scanRunState(old, scanBaseline(old))).toEqual({ phase: "idle" });
    expect(scanRunState(null, 0)).toEqual({ phase: "idle" });
  });
  it("aktif → running; yükleme bekliyor → uploading; bitti → done", () => {
    expect(scanRunState(view({ active: true }), 0)).toEqual({ phase: "running" });
    const tried = [portal("sahibinden", { lastTryAt: 200, lastResult: "complete", lastRead: 12, lastExpected: 12 })];
    expect(scanRunState(view({ portals: tried, pendingUploads: 1 }), 100)).toEqual({ phase: "uploading" });
    expect(scanRunState(view({ portals: tried }), 100)).toEqual({ phase: "done", portals: [{ id: "sahibinden", result: "complete", read: 12, expected: 12 }] });
  });
  it("engelli/okunamayan portal asla okunmuş sayılmaz", () => {
    const s = scanRunState(view({ portals: [portal("sahibinden", { lastTryAt: 300, lastResult: "blocked" })] }), 0);
    expect(s.phase).toBe("done");
    if (s.phase === "done") expect(hasReadResult(s.portals)).toBe(false);
  });
});
