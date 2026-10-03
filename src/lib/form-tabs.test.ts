import { describe, expect, it } from "vitest";
import {
  DRAFT_TTL_MS,
  commissionSummary,
  computeTabState,
  draftKeyPrefix,
  draftStorageKey,
  encodeDraft,
  firstInvalidTab,
  formatClock,
  formatDraftTime,
  isSensitiveFieldName,
  neighborTabId,
  nextTabId,
  parseDraft,
  parseLooseNumber,
  pickDraftFields,
  progressSummary,
  resolveInitialTab,
  tabForField,
  type TabDef,
} from "./form-tabs";

const ids = ["a", "b", "c"];
const tabs: TabDef[] = [
  { id: "a", fields: ["name", "type"], required: ["name"] },
  { id: "b", fields: ["phone", "email"] },
  { id: "c", fields: [] },
];

describe("nextTabId", () => {
  it("ok tuşları ve uçlarda döner", () => {
    expect(nextTabId(ids, "a", "ArrowDown")).toBe("b");
    expect(nextTabId(ids, "a", "ArrowRight")).toBe("b");
    expect(nextTabId(ids, "c", "ArrowDown")).toBe("a");
    expect(nextTabId(ids, "a", "ArrowUp")).toBe("c");
    expect(nextTabId(ids, "b", "ArrowLeft")).toBe("a");
  });
  it("Home/End", () => {
    expect(nextTabId(ids, "b", "Home")).toBe("a");
    expect(nextTabId(ids, "b", "End")).toBe("c");
  });
  it("bilinmeyen mevcut sekme ilke düşer; boş liste mevcutu korur", () => {
    expect(nextTabId(ids, "zzz", "ArrowDown")).toBe("a");
    expect(nextTabId([], "x", "ArrowDown")).toBe("x");
  });
  it("neighborTabId uçta null", () => {
    expect(neighborTabId(ids, "a", -1)).toBeNull();
    expect(neighborTabId(ids, "a", 1)).toBe("b");
    expect(neighborTabId(ids, "c", 1)).toBeNull();
    expect(neighborTabId(ids, "yok", 1)).toBeNull();
  });
  it("resolveInitialTab geçersizde ilk sekme", () => {
    expect(resolveInitialTab(ids, "b")).toBe("b");
    expect(resolveInitialTab(ids, "x")).toBe("a");
    expect(resolveInitialTab(ids, null)).toBe("a");
    expect(resolveInitialTab([], "x")).toBe("");
  });
});

describe("computeTabState", () => {
  it("zorunlu eksik / tam", () => {
    expect(computeTabState(tabs[0], {})).toMatchObject({ complete: false, missing: ["name"], status: "missing" });
    expect(computeTabState(tabs[0], { name: "  " }).status).toBe("missing");
    expect(computeTabState(tabs[0], { name: "Ali" })).toMatchObject({ complete: true, missing: [], status: "complete", filled: 1 });
  });
  it("zorunlusuz sekme: dolu alan varsa tamam, yoksa boş", () => {
    expect(computeTabState(tabs[1], {}).status).toBe("empty");
    expect(computeTabState(tabs[1], { email: "x" })).toMatchObject({ complete: true, status: "complete" });
  });
  it("alansız bilgi sekmesi none", () => {
    expect(computeTabState(tabs[2], {}).status).toBe("none");
  });
  it("progressSummary bilgi sekmesini saymaz", () => {
    expect(progressSummary(tabs, { name: "Ali" })).toEqual({ done: 1, total: 2 });
    expect(progressSummary(tabs, { name: "Ali", phone: "1" })).toEqual({ done: 2, total: 2 });
  });
});

describe("hata -> sekme", () => {
  it("tabForField", () => {
    expect(tabForField(tabs, "email")).toBe("b");
    expect(tabForField(tabs, "yok")).toBeNull();
  });
  it("firstInvalidTab sekme sırasındaki ilki", () => {
    expect(firstInvalidTab(tabs, ["email", "name"])).toBe("a");
    expect(firstInvalidTab(tabs, ["email"])).toBe("b");
    expect(firstInvalidTab(tabs, ["yok"])).toBeNull();
    expect(firstInvalidTab(tabs, [])).toBeNull();
  });
});

describe("taslak beyaz listesi", () => {
  const values = {
    full_name: "Ali Kaya",
    type: "Alıcı",
    branch_id: "b1",
    phone: "05321234567",
    email: "a@b.co",
    notes: "özel not",
    body: "sözleşme metni",
    description: "açıklama",
    tc_no: "11111111111",
    iban: "TR00",
    list_price: "",
  };
  it("yalnız beyaz listedeki dolu alanlar", () => {
    expect(pickDraftFields(values, ["type", "branch_id", "list_price"])).toEqual({ type: "Alıcı", branch_id: "b1" });
  });
  it("hassas alan beyaz listeye girse bile asla geçmez", () => {
    const out = pickDraftFields(values, ["type", "phone", "email", "notes", "body", "description", "tc_no", "iban", "full_name"]);
    expect(Object.keys(out)).toEqual(["type", "full_name"]);
    for (const n of ["phone", "email", "notes", "body", "description", "tc_no", "iban", "address_line", "anniversary_note"]) {
      expect(isSensitiveFieldName(n)).toBe(true);
    }
  });
  it("pilot formların beyaz listesi hassas sayılmaz", () => {
    for (const n of ["type", "branch_id", "title", "transaction_type", "property_type", "rooms", "sqm", "list_price", "commission_rate", "floor", "heating", "building_age", "facade"]) {
      expect(isSensitiveFieldName(n)).toBe(false);
    }
  });
});

describe("taslak depolama", () => {
  const key = draftStorageKey("u1", "musteri");
  it("anahtar biçimi ve önek", () => {
    expect(key).toBe("emlaksoft:draft:v1:u1:musteri");
    expect(key.startsWith(draftKeyPrefix("u1"))).toBe(true);
    expect(key.startsWith(draftKeyPrefix("u2"))).toBe(false);
  });
  it("gidiş-dönüş", () => {
    const raw = encodeDraft({ type: "Alıcı" }, 1_000_000);
    expect(parseDraft(raw, 1_000_500)).toEqual({ v: 1, savedAt: 1_000_000, values: { type: "Alıcı" } });
  });
  it("TTL: 7 gün", () => {
    const raw = encodeDraft({ type: "Alıcı" }, 1_000_000);
    expect(parseDraft(raw, 1_000_000 + DRAFT_TTL_MS)).not.toBeNull();
    expect(parseDraft(raw, 1_000_000 + DRAFT_TTL_MS + 1)).toBeNull();
  });
  it("bozuk/boş/yanlış sürüm -> null", () => {
    expect(parseDraft(null, 1)).toBeNull();
    expect(parseDraft("", 1)).toBeNull();
    expect(parseDraft("{bozuk", 1)).toBeNull();
    expect(parseDraft("[]", 1)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 9, savedAt: 1, values: { a: "b" } }), 2)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, savedAt: 1, values: {} }), 2)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 1, savedAt: 1, values: [1] }), 2)).toBeNull();
  });
  it("diskten gelen hassas alan okunurken de elenir", () => {
    const raw = JSON.stringify({ v: 1, savedAt: 10, values: { phone: "0532", type: "Alıcı", n: 5 } });
    expect(parseDraft(raw, 20)?.values).toEqual({ type: "Alıcı" });
  });
  it("gelecekteki zaman damgası reddedilir", () => {
    const raw = encodeDraft({ type: "x" }, 10_000_000);
    expect(parseDraft(raw, 1_000)).toBeNull();
  });
  it("formatClock 2 haneli", () => {
    expect(formatClock(0)).toMatch(/^\d{2}:\d{2}$/);
  });
  it("formatDraftTime aynı gün / farklı gün", () => {
    const noon = new Date(2026, 9, 3, 12, 0).getTime();
    expect(formatDraftTime(new Date(2026, 9, 3, 9, 5).getTime(), noon)).toBe("bugün 09:05");
    expect(formatDraftTime(new Date(2026, 9, 1, 14, 32).getTime(), noon)).toBe("01.10 14:32");
  });
});

describe("sayı ve komisyon özeti", () => {
  it("parseLooseNumber Türkçe biçimler", () => {
    expect(parseLooseNumber("6.750.000")).toBe(6_750_000);
    expect(parseLooseNumber("6750000,50")).toBe(6_750_000.5);
    expect(parseLooseNumber("3,5")).toBe(3.5);
    expect(parseLooseNumber("3.5")).toBe(3.5);
    expect(parseLooseNumber("185")).toBe(185);
    expect(parseLooseNumber("")).toBeNull();
    expect(parseLooseNumber("-5")).toBeNull();
    expect(parseLooseNumber("abc")).toBeNull();
  });
  it("commissionSummary", () => {
    expect(commissionSummary("6.750.000", "3")).toEqual({ amount: 202_500, perSqm: null });
    expect(commissionSummary("6.750.000", "2,5", "185")).toEqual({ amount: 168_750, perSqm: 36_486 });
  });
  it("boş / negatif / sınır -> null", () => {
    expect(commissionSummary("", "3")).toBeNull();
    expect(commissionSummary("1000", "")).toBeNull();
    expect(commissionSummary("-1000", "3")).toBeNull();
    expect(commissionSummary("0", "3")).toBeNull();
    expect(commissionSummary("1000", "0")).toBeNull();
    expect(commissionSummary("1000", "100.5")).toBeNull();
    expect(commissionSummary("1000", "100")).toEqual({ amount: 1000, perSqm: null });
    expect(commissionSummary("1000", "3", "0")?.perSqm).toBeNull();
  });
});
