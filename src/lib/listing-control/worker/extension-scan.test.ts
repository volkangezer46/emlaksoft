import { describe, expect, it } from "vitest";
import {
  applyPage,
  buildUpload,
  dueUploads,
  duePortals,
  enqueueUpload,
  markUploadDone,
  markUploadFailed,
  nextPortalState,
  sanitizeUpload,
  SCAN_LIMITS,
  startScan,
  type ScanOutcome,
  type ScanStep,
} from "./extension-scan";
import type { StoreItem } from "../adapters/html/parse-core";

const NOW = Date.parse("2026-10-10T08:00:00Z");
const H = 3_600_000;
const item = (n: number): StoreItem => ({ externalId: String(100000 + n), url: `https://www.sahibinden.com/ilan/x-${100000 + n}/detay`, title: `İlan ${n}`, price: 1_000_000 + n });
const page = (from: number, count: number, nextUrl: string | null, totalCount: number | null) => ({
  items: Array.from({ length: count }, (_, i) => item(from + i)),
  nextUrl,
  error: null,
  totalCount,
});
const finished = (s: ScanStep): ScanOutcome => {
  if (s.kind !== "finished") throw new Error("bitmedi");
  return s.outcome;
};

describe("günlük tarama zamanlaması", () => {
  const on = () => true;
  it("hiç taranmamış portal hazırdır; tam taramadan 20 saat sonra yeniden", () => {
    expect(duePortals({}, ["sahibinden"], on, NOW)).toEqual(["sahibinden"]);
    const s = { sahibinden: { lastFullAt: NOW - 19 * H, lastTryAt: NOW - 19 * H, lastResult: "complete" as const, lastRead: 3, lastExpected: 3 } };
    expect(duePortals(s, ["sahibinden"], on, NOW)).toEqual([]);
    expect(duePortals({ sahibinden: { ...s.sahibinden, lastFullAt: NOW - 21 * H, lastTryAt: NOW - 21 * H } }, ["sahibinden"], on, NOW)).toEqual(["sahibinden"]);
  });
  it("kaçırılan gün ilk açılışta telafi edilir (30 saat önce)", () => {
    const s = { emlakjet: { lastFullAt: NOW - 30 * H, lastTryAt: NOW - 30 * H, lastResult: "complete" as const, lastRead: 1, lastExpected: 1 } };
    expect(duePortals(s, ["emlakjet"], on, NOW)).toEqual(["emlakjet"]);
  });
  it("başarısız deneme 2 saat dolmadan tekrarlanmaz; kapalı portal taranmaz", () => {
    const s = { sahibinden: { lastFullAt: null, lastTryAt: NOW - H, lastResult: "unreadable" as const, lastRead: 0, lastExpected: null } };
    expect(duePortals(s, ["sahibinden"], on, NOW)).toEqual([]);
    expect(duePortals(s, ["sahibinden"], on, NOW + 2 * H)).toEqual(["sahibinden"]);
    expect(duePortals({}, ["sahibinden"], () => false, NOW)).toEqual([]);
  });
});

describe("sayfalı tarama ve tamlık kanıtı", () => {
  it("toplam okunur, sayfalar bitince TAM", () => {
    let s: ScanStep = applyPage(startScan("sahibinden", "https://x.sahibinden.com/ilanlarim", NOW), page(0, 20, "https://x.sahibinden.com/ilanlarim?p=2", 25));
    expect(s.kind).toBe("continue");
    if (s.kind !== "continue") return;
    s = applyPage(s.progress, page(20, 5, null, 25));
    const o = finished(s);
    expect(o).toMatchObject({ kind: "complete", complete: true, expected: 25, read: 25, pages: 2 });
  });
  it("toplam sayı okunamadıysa TAM sayılmaz (no_total)", () => {
    const o = finished(applyPage(startScan("sahibinden", "https://x.sahibinden.com/a", NOW), page(0, 5, null, null)));
    expect(o).toMatchObject({ kind: "partial", complete: false, reason: "no_total" });
  });
  it("okunan sayı toplamdan azsa TAM sayılmaz (short)", () => {
    const o = finished(applyPage(startScan("sahibinden", "https://x.sahibinden.com/a", NOW), page(0, 5, null, 8)));
    expect(o).toMatchObject({ complete: false, reason: "short" });
  });
  it("döngü ve sayfa sınırı: tekrar eden sonraki adres eksik sayılır", () => {
    const p0 = startScan("sahibinden", "https://x.sahibinden.com/a", NOW);
    const o = finished(applyPage(p0, page(0, 5, "https://x.sahibinden.com/a", 50)));
    expect(o).toMatchObject({ complete: false, reason: "page_limit" });
  });
  it("sayfa sınırı aşılınca eksik", () => {
    let p = startScan("sahibinden", "https://x.sahibinden.com/0", NOW);
    let out: ScanOutcome | null = null;
    for (let i = 1; i <= SCAN_LIMITS.maxPages + 2; i += 1) {
      const s = applyPage(p, page(i * 10, 5, `https://x.sahibinden.com/${i}`, 9999));
      if (s.kind === "finished") {
        out = s.outcome;
        break;
      }
      p = s.progress;
    }
    expect(out).toMatchObject({ complete: false, reason: "page_limit" });
  });
  it("okunamayan ilk sayfa 'unreadable'; engel 'blocked'; sonraki sayfa hatası 'partial'", () => {
    const p0 = startScan("hepsiemlak", "https://www.hepsiemlak.com/ilanlarim", NOW);
    expect(finished(applyPage(p0, { items: [], nextUrl: null, error: "no_items" }))).toMatchObject({ kind: "unreadable", complete: false, reason: "no_items" });
    expect(finished(applyPage(p0, { items: [], nextUrl: null, error: "captcha" }))).toMatchObject({ kind: "blocked", complete: false });
    expect(finished(applyPage(p0, { items: [], nextUrl: null, error: "http_429" }))).toMatchObject({ kind: "blocked" });
    const s = applyPage(p0, page(0, 3, "https://www.hepsiemlak.com/ilanlarim?p=2", 6));
    if (s.kind !== "continue") throw new Error("devam bekleniyordu");
    expect(finished(applyPage(s.progress, { items: [], nextUrl: null, error: "http_500" }))).toMatchObject({ kind: "partial", complete: false, read: 3 });
  });
  it("aynı ilan iki sayfada görülürse tekilleşir", () => {
    const s = applyPage(startScan("sahibinden", "https://x.sahibinden.com/a", NOW), page(0, 3, "https://x.sahibinden.com/b", 4));
    if (s.kind !== "continue") throw new Error("devam");
    expect(finished(applyPage(s.progress, page(2, 2, null, 4))).read).toBe(4);
  });
});

describe("yükleme kuyruğu", () => {
  const outcome = finished(applyPage(startScan("sahibinden", "https://x.sahibinden.com/a", NOW), page(0, 3, null, 3)));
  it("aynı portalın eski bekleyeni yenisiyle değişir; başarısız yeniden denemede bekler", () => {
    const u1 = buildUpload(outcome, "e2@x", NOW);
    const u2 = buildUpload({ ...outcome, startedAt: NOW + 1 }, "e2@x", NOW + 1);
    let list = enqueueUpload(enqueueUpload([], u1, NOW), u2, NOW + 1);
    expect(list).toHaveLength(1);
    expect(dueUploads(list, NOW + 2)).toHaveLength(1);
    list = markUploadFailed(list, u2.id, NOW + 2);
    expect(dueUploads(list, NOW + 3)).toHaveLength(0);
    expect(dueUploads(list, NOW + 10 * 60_000)).toHaveLength(1);
    expect(markUploadDone(list, u2.id)).toEqual([]);
  });
  it("tamamlanan tarama durumu son tam taramayı günceller; eksik güncellemez", () => {
    expect(nextPortalState(undefined, outcome, NOW).lastFullAt).toBe(NOW);
    const partial = { ...outcome, complete: false, kind: "partial" as const };
    expect(nextPortalState({ lastFullAt: 5, lastTryAt: 5, lastResult: "complete", lastRead: 1, lastExpected: 1 }, partial, NOW).lastFullAt).toBe(5);
  });
});

describe("sunucu doğrulaması", () => {
  const base = { portal: "sahibinden", kind: "complete", complete: true, expected: 2, parserVersion: "e2@2026-10-10.1", items: [{ externalId: "123456", url: "https://www.sahibinden.com/ilan/x-123456/detay", price: 2_000_000 }, { externalId: "654321", url: "", status: "passive" }] };
  it("tamlık sunucuda yeniden hesaplanır", () => {
    expect(sanitizeUpload(base)).toMatchObject({ complete: true, read: 2, expected: 2 });
    expect(sanitizeUpload({ ...base, expected: 3 })).toMatchObject({ complete: false });
    expect(sanitizeUpload({ ...base, expected: null })).toMatchObject({ complete: false });
    expect(sanitizeUpload({ ...base, kind: "partial" })).toMatchObject({ complete: false });
    expect(sanitizeUpload({ ...base, expected: 0 })).toMatchObject({ complete: false });
  });
  it("geçersiz ilan no atılır; kötü biçim reddedilir", () => {
    const v = sanitizeUpload({ ...base, items: [{ externalId: "abc" }, { externalId: "123456" }, { externalId: "123456" }] });
    expect(v?.items).toHaveLength(1);
    expect(sanitizeUpload({ ...base, portal: "A B" })).toBeNull();
    expect(sanitizeUpload({ ...base, kind: "x" })).toBeNull();
    expect(sanitizeUpload("x")).toBeNull();
    expect(sanitizeUpload({ ...base, items: new Array(SCAN_LIMITS.maxItems + 1).fill({}) })).toBeNull();
  });
});
