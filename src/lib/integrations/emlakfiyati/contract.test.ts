import { describe, expect, it } from "vitest";
import {
  buildEndeksPath,
  buildEndeksUrl,
  endeksRequestSchema,
  endeksWeight,
  mapPropertyTypeToTip,
  parentPath,
  parseEndeksResponse,
  summarizeEndeks,
  toEndeksValuationSource,
} from "./contract";

const row = (over: Record<string, unknown> = {}) => ({
  path: "aydin/didim",
  ad: "Didim",
  level: 2,
  tip: "arsa",
  donem: "2026-10-01",
  n: 6,
  medyan_tl_m2: 15488,
  p25: 12847,
  p75: 29795,
  ort_m2: 431,
  medyan_fiyat: 7000000,
  aylik_degisim: 0,
  yillik_degisim: null,
  kalibre_tl_m2: 15488,
  guven: "low",
  yetersiz_orneklem: false,
  ...over,
});

describe("EmlakFiyati istek sözleşmesi", () => {
  it("yalnız coğrafi yol ve tip taşır; fazla alan ve geçersiz yol reddedilir", () => {
    expect(endeksRequestSchema.safeParse({ path: "aydin/didim", tip: "arsa" }).success).toBe(true);
    expect(endeksRequestSchema.safeParse({ path: "aydin/didim", tip: "arsa", phone: "0532" }).success).toBe(false);
    expect(endeksRequestSchema.safeParse({ path: "../etc/passwd", tip: "arsa" }).success).toBe(false);
    expect(endeksRequestSchema.safeParse({ path: "Aydin/Didim", tip: "arsa" }).success).toBe(false);
    expect(endeksRequestSchema.safeParse({ path: "a/b/c/d", tip: "arsa" }).success).toBe(false);
    expect(endeksRequestSchema.safeParse({ path: "aydin", tip: "daire" }).success).toBe(false);
  });

  it("adresi yalnız https + emlakfiyati.com üzerinde, path ve tip sorgusuyla kurar", () => {
    const url = new URL(buildEndeksUrl({ path: "istanbul/kadikoy", tip: "konut" }));
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("emlakfiyati.com");
    expect(url.pathname).toBe("/api/endeks");
    expect(url.searchParams.get("path")).toBe("istanbul/kadikoy");
    expect(url.searchParams.get("tip")).toBe("konut");
    expect([...url.searchParams.keys()].sort()).toEqual(["path", "tip"]);
  });

  it("il/ilçe/mahalle adlarını geo normalizasyonuyla ASCII slug'a çevirir", () => {
    expect(buildEndeksPath({ province: "İstanbul", district: "Kadıköy" })).toBe("istanbul/kadikoy");
    expect(buildEndeksPath({ province: "Aydın", district: "Didim", neighborhood: "Akbük Mahallesi" })).toBe("aydin/didim/akbuk");
    expect(buildEndeksPath({ province: "Iğdır" })).toBe("igdir");
    expect(buildEndeksPath({ province: "Kahramanmaraş", district: "Onikişubat" })).toBe("kahramanmaras/onikisubat");
    // ilçe yoksa mahalle yok sayılır; il yoksa yol yok
    expect(buildEndeksPath({ province: "Ankara", neighborhood: "Kızılay" })).toBe("ankara");
    expect(buildEndeksPath({ province: null, district: "Kadıköy" })).toBeNull();
    expect(buildEndeksPath({ province: "  " })).toBeNull();
  });

  it("üst yol: mahalle -> ilçe -> il -> null", () => {
    expect(parentPath("a/b/c")).toBe("a/b");
    expect(parentPath("a/b")).toBe("a");
    expect(parentPath("a")).toBeNull();
  });
});

describe("ilan türü -> EmlakFiyati tipi", () => {
  it("canlı yoklamada doğrulanan tipler: konut ve arsa", () => {
    for (const t of ["Daire", "Villa", "Müstakil ev", "Rezidans", "Yazlık"]) {
      expect(mapPropertyTypeToTip(t, "Satılık")).toBe("konut");
    }
    expect(mapPropertyTypeToTip("Arsa", "Satılık")).toBe("arsa");
    expect(mapPropertyTypeToTip("ARSA")).toBe("arsa");
  });

  it("desteklenmeyen tür, boş değer ve kiralık için veri yok (null)", () => {
    for (const t of ["İşyeri", "Dükkan", "Ofis", "Depo", "Bina", "Tarla", "", null, undefined]) {
      expect(mapPropertyTypeToTip(t, "Satılık")).toBeNull();
    }
    expect(mapPropertyTypeToTip("Daire", "Kiralık")).toBeNull();
    expect(mapPropertyTypeToTip("Daire", "rent")).toBeNull();
    expect(mapPropertyTypeToTip("Daire", "sale")).toBe("konut");
  });
});

describe("EmlakFiyati yanıt doğrulama", () => {
  it("gerçek örnek satırı (null'lar ve ek alanlar toleranslı) geçer", () => {
    const res = parseEndeksResponse([{ ...row(), ekstra: "yok sayılır" }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows[0]?.yillik_degisim).toBeNull();
      expect("ekstra" in (res.rows[0] as object)).toBe(false);
    }
  });

  it("boş dizi geçerlidir (veri yok); dizi olmayan ya da tamamı bozuk yanıt reddedilir", () => {
    expect(parseEndeksResponse([])).toEqual({ ok: true, rows: [] });
    expect(parseEndeksResponse({ error: "x" }).ok).toBe(false);
    expect(parseEndeksResponse(null).ok).toBe(false);
    expect(parseEndeksResponse([{ foo: 1 }]).ok).toBe(false);
  });

  it("bozuk satır atlanır, kalanlar en yeni dönem ilk sıralanır; bilinmeyen güven 'low' olur", () => {
    const res = parseEndeksResponse([
      row({ donem: "2026-08-01" }),
      row({ donem: "2026-10-01", guven: "weird" }),
      row({ donem: "2026-09-01", medyan_tl_m2: -5 }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rows.map((r) => r.donem)).toEqual(["2026-10-01", "2026-08-01"]);
      expect(res.rows[0]?.guven).toBe("low");
    }
  });
});

describe("özet ve değerleme kaynağı", () => {
  const parsed = (rows: unknown[]) => {
    const r = parseEndeksResponse(rows);
    if (!r.ok) throw new Error("beklenmeyen");
    return r.rows;
  };

  it("son 12 dönem trendi eskiden yeniye; kalibre değer varsa o kullanılır", () => {
    const rows = parsed(
      Array.from({ length: 14 }, (_, i) =>
        row({
          donem: new Date(Date.UTC(2026, 9 - i, 1)).toISOString().slice(0, 10),
          medyan_tl_m2: 1000 + i,
          kalibre_tl_m2: 2000 + i,
        }),
      ),
    );
    const s = summarizeEndeks(rows, "konut")!;
    expect(s.trend).toHaveLength(12);
    expect(s.trend[0]!.donem < s.trend[11]!.donem).toBe(true);
    expect(s.medianM2).toBe(2000);
    expect(summarizeEndeks([], "konut")).toBeNull();
  });

  it("ağırlık güven ve örneklemden türer; yetersiz örneklem düşük ağırlık alır", () => {
    expect(endeksWeight({ guven: "high", insufficient: false })).toBe(0.4);
    expect(endeksWeight({ guven: "medium", insufficient: false })).toBe(0.3);
    expect(endeksWeight({ guven: "low", insufficient: false })).toBe(0.15);
    expect(endeksWeight({ guven: "high", insufficient: true })).toBe(0.08);
  });

  it("değer = medyan TL/m2 x m2; geçersiz m2 kaynak üretmez; not kaynağı ve dönemi söyler", () => {
    const s = summarizeEndeks(parsed([row({ guven: "medium", n: 40, yillik_degisim: 55.5 })]), "arsa")!;
    const src = toEndeksValuationSource(s, 200)!;
    expect(src.name).toBe("EmlakFiyati endeksi");
    expect(src.value).toBe(15488 * 200);
    expect(src.weight).toBe(0.3);
    expect(src.note).toContain("Ekim 2026");
    expect(src.note).toContain("40 ilan");
    expect(src.note).toContain("yıllık değişim %55.5");
    expect(toEndeksValuationSource(s, 0)).toBeNull();
    expect(toEndeksValuationSource(s, Number.NaN)).toBeNull();
  });
});
