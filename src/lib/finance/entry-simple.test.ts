import { describe, expect, it } from "vitest";
import { detailsOpenKey, entryHref, parseEntryPrefill, topCategories, type RecentEntry } from "./entry-workspace";

const UUID = "11111111-2222-4333-8444-555555555555";

const cats = [
  { value: "portal", label: "Portal" },
  { value: "reklam", label: "Reklam" },
  { value: "kira", label: "Kira" },
  { value: "ofis", label: "Ofis" },
  { value: "ulasim", label: "Ulaşım" },
  { value: "muhasebe", label: "Muhasebe" },
  { value: "sgk", label: "SGK" },
  { value: "diger_gider", label: "Diğer gider" },
];

function entry(category: string, date: string, direction: "in" | "out" = "out"): RecentEntry {
  return { id: `${category}-${date}`, accountId: "a", direction, amount: 100, date, category, title: "", counterparty: null };
}

describe("topCategories (sade kategori çipleri)", () => {
  it("geçmiş yoksa tanım sırasındaki ilk 6 kategori", () => {
    expect(topCategories(cats, [], "out").map((c) => c.value)).toEqual(["portal", "reklam", "kira", "ofis", "ulasim", "muhasebe"]);
  });

  it("en sık kullanılan önce; eşitlikte en yeni; geri kalanı tanım sırasıyla tamamlanır", () => {
    const recent = [entry("sgk", "2026-10-01"), entry("sgk", "2026-10-02"), entry("diger_gider", "2026-10-03"), entry("kira", "2026-10-05"), entry("komisyon", "2026-10-05", "in")];
    expect(topCategories(cats, recent, "out", 4).map((c) => c.value)).toEqual(["sgk", "kira", "diger_gider", "portal"]);
  });

  it("seçili kategori ilk 6'da değilse sona eklenir; transferde çip yok", () => {
    expect(topCategories(cats, [], "out", 6, "diger_gider").map((c) => c.value).at(-1)).toBe("diger_gider");
    expect(topCategories(cats, [], "out", 6, "bilinmeyen")).toHaveLength(6);
    expect(topCategories(cats, [], "transfer")).toEqual([]);
  });
});

describe("portföy önceden doldurma", () => {
  it("entryHref ↔ parseEntryPrefill gidiş-dönüş (portföy kimliği + adı)", () => {
    const href = entryHref({ tab: "gider", category: "reklam", propertyId: UUID, propertyLabel: "P-102 · Kadıköy 3+1", title: "İlan reklamı" });
    const p = parseEntryPrefill(Object.fromEntries(new URL(href, "https://x").searchParams));
    expect(p).toMatchObject({ tab: "gider", category: "reklam", propertyId: UUID, propertyLabel: "P-102 · Kadıköy 3+1", title: "İlan reklamı" });
  });

  it("geçersiz portföy kimliği yazılmaz ve okunmaz", () => {
    expect(entryHref({ tab: "gider", propertyId: "drop", propertyLabel: "x" })).toBe("/app/giderler/kayit?tur=gider");
    expect(parseEntryPrefill({ portfoy: "1", portfoy_ad: "x" })).toMatchObject({ propertyId: null, propertyLabel: null });
  });

  it("ayrıntılar tercihi kullanıcı başına anahtar", () => {
    expect(detailsOpenKey("u1")).not.toBe(detailsOpenKey("u2"));
  });
});
