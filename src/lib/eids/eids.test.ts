import { describe, expect, it } from "vitest";
import { parseEidsPropertyNo, hasValidEidsNo } from "./property-no";
import { addMonthsDay, evaluateAuthorityTerm, shortAuthorityWarning } from "./authority-term";
import { isEidsFilter, summarizeEids } from "./status";
import { computeHealthScore } from "@/lib/listing-control/health-score";
import { checkAuthorityShield } from "@/lib/authority-shield";
import { eidsHealthValue } from "./health";

const NOW = Date.parse("2026-10-06T09:00:00+03:00");

describe("parseEidsPropertyNo", () => {
  it("boş girdi geçerli ve null", () => {
    expect(parseEidsPropertyNo("")).toEqual({ ok: true, value: null });
    expect(parseEidsPropertyNo("   ")).toEqual({ ok: true, value: null });
    expect(parseEidsPropertyNo(null)).toEqual({ ok: true, value: null });
  });
  it("normalize eder: boşluk/nokta temizlenir, büyük harf", () => {
    expect(parseEidsPropertyNo("ab 12.34-56")).toEqual({ ok: true, value: "AB1234-56" });
    expect(parseEidsPropertyNo("tk1234567")).toEqual({ ok: true, value: "TK1234567" });
  });
  it("kısa, uzun ve sembollü değeri reddeder", () => {
    expect(parseEidsPropertyNo("12345").ok).toBe(false);
    expect(parseEidsPropertyNo("1".repeat(25)).ok).toBe(false);
    expect(parseEidsPropertyNo("AB#12345").ok).toBe(false);
  });
  it("hasValidEidsNo", () => {
    expect(hasValidEidsNo("ABC123")).toBe(true);
    expect(hasValidEidsNo("abc123")).toBe(false);
    expect(hasValidEidsNo(null)).toBe(false);
  });
});

describe("evaluateAuthorityTerm", () => {
  it("bitiş yoksa missing", () => {
    expect(evaluateAuthorityTerm({ start: null, end: null }, NOW).state).toBe("missing");
  });
  it("dolmuş", () => {
    const t = evaluateAuthorityTerm({ start: "2026-01-01", end: "2026-10-05" }, NOW);
    expect(t.state).toBe("expired");
    expect(t.daysLeft).toBe(-1);
  });
  it("15/7/3 gün pencereleri", () => {
    expect(evaluateAuthorityTerm({ start: "2026-01-01", end: "2026-10-21" }, NOW)).toMatchObject({ state: "expiring", urgency: "soon", daysLeft: 15 });
    expect(evaluateAuthorityTerm({ start: "2026-01-01", end: "2026-10-13" }, NOW)).toMatchObject({ urgency: "warning", daysLeft: 7 });
    expect(evaluateAuthorityTerm({ start: "2026-01-01", end: "2026-10-09" }, NOW)).toMatchObject({ urgency: "critical", daysLeft: 3 });
    expect(evaluateAuthorityTerm({ start: "2026-01-01", end: "2026-10-06" }, NOW)).toMatchObject({ urgency: "critical", daysLeft: 0 });
    expect(evaluateAuthorityTerm({ start: "2026-01-01", end: "2026-10-22" }, NOW).state).toBe("ok");
  });
  it("3 ay kuralı: tam 3 ay geçerli, bir gün eksik kısa", () => {
    expect(evaluateAuthorityTerm({ start: "2026-10-01", end: "2027-01-01" }, NOW).short).toBe(false);
    expect(evaluateAuthorityTerm({ start: "2026-10-01", end: "2026-12-31" }, NOW).short).toBe(true);
    expect(evaluateAuthorityTerm({ start: "2026-10-01", end: "2026-12-31" }, NOW).message).toMatch(/3 aydan kısa/);
  });
  it("ay sonu taşması: 31 Ocak + 3 ay = 30 Nisan", () => {
    const start = Math.floor(Date.UTC(2026, 0, 31) / 86_400_000);
    expect(addMonthsDay(start, 3)).toBe(Math.floor(Date.UTC(2026, 3, 30) / 86_400_000));
  });
  it("shortAuthorityWarning yalnız kısa ise uyarır", () => {
    expect(shortAuthorityWarning("2026-10-01", "2026-11-01", NOW)).toMatch(/en az 3 ay/);
    expect(shortAuthorityWarning("2026-10-01", "2027-02-01", NOW)).toBeNull();
    expect(shortAuthorityWarning(null, "2026-11-01", NOW)).toBeNull();
  });
});

describe("summarizeEids", () => {
  const rows = [
    { id: "a", status: "live", eids_property_no: "ABC123", authorization_start: "2026-08-01", authorization_end: "2027-02-01" },
    { id: "b", status: "live", eids_property_no: null, authorization_start: "2026-10-01", authorization_end: "2026-12-01" },
    { id: "c", status: "draft", eids_property_no: null, authorization_start: null, authorization_end: null },
    { id: "d", status: "live", eids_property_no: "XYZ999", authorization_start: "2026-05-01", authorization_end: "2026-10-10" },
    { id: "e", status: "sold", eids_property_no: null, authorization_start: null, authorization_end: null },
    { id: "f", status: "live", eids_property_no: "QWE456", authorization_start: "2026-01-01", authorization_end: "2026-09-01" },
  ];
  const s = summarizeEids(rows, NOW);
  it("kapsam dışı durumlar sayılmaz", () => {
    expect(s.scope).toBe(5);
    expect(s.withEidsNo).toBe(3);
  });
  it("süzgeç kümeleri", () => {
    expect(s.ids.eids_eksik).toEqual(["b", "c"]);
    expect(s.ids.yetki_eksik).toEqual(["c"]);
    expect(s.ids.kisa).toEqual(["b"]);
    expect(s.ids.bitiyor).toEqual(["d"]);
    expect(s.ids.dolmus).toEqual(["f"]);
    expect(s.counts.eids_eksik).toBe(2);
  });
  it("isEidsFilter", () => {
    expect(isEidsFilter("kisa")).toBe(true);
    expect(isEidsFilter("x")).toBe(false);
  });
});

describe("authority-shield EİDS notları", () => {
  it("yazılı yetki varsa ok kalır; EİDS eksikse yalnız not döner", () => {
    const r = checkAuthorityShield({ hasWrittenAuthority: true, eidsNoPresent: false, authorityShort: true });
    expect(r.ok).toBe(true);
    expect(r.notes).toHaveLength(2);
  });
  it("ölçülemediyse (null) not üretmez; yetki yoksa engeller", () => {
    expect(checkAuthorityShield({ hasWrittenAuthority: true, eidsNoPresent: null }).notes).toBeUndefined();
    expect(checkAuthorityShield({ hasWrittenAuthority: false, eidsNoPresent: true }).ok).toBe(false);
  });
});

describe("eidsHealthValue", () => {
  it("null ölçülemedi, yok 0, var 1, kısa yetki 0.5", () => {
    expect(eidsHealthValue(null)).toBeNull();
    expect(eidsHealthValue(false)).toBe(0);
    expect(eidsHealthValue(true)).toBe(1);
    expect(eidsHealthValue(true, true)).toBe(0.5);
  });
});

describe("sağlık skoru eids bileşeni", () => {
  it("ölçülürse skora katılır, null ise paydadan çıkar", () => {
    const base = { onPortal: 1, price: 1, advisor: 1, authority: 1, photos: 1, freshness: 1, idUrlValid: 1, contact: 1, checkRecency: 1 };
    const withNo = computeHealthScore({ ...base, eids: 1 });
    const without = computeHealthScore({ ...base, eids: 0 });
    const unknown = computeHealthScore({ ...base, eids: null });
    expect(withNo.score).toBe(100);
    expect(without.score).toBeLessThan(100);
    expect(unknown.partial).toBe(true);
  });
});
