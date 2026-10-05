import { describe, expect, it } from "vitest";
import { parseOrtakValuation, type OrtakValuationOk } from "@/lib/integrations/emlakfiyati/ortak-contract";
import { EF_LISTING_PRICE_NOTE, EF_LOW_CONFIDENCE_TITLE, presentValuation } from "./present";

const RID = "3f0c2d9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

function parse(body: Record<string, unknown>): OrtakValuationOk {
  const r = parseOrtakValuation({ sonuc_durumu: "deger", ucretlendirilir: true, rapor_id: RID, ...body });
  if (!r.ok || r.value.durum !== "deger") throw new Error("ayrıştırılamadı");
  return r.value;
}

describe("K10 sunum", () => {
  it("düşük güven: 'Düşük güven: kesin TL yok' + guven_sunumu; null TL asla 0/bilinmiyor değil", () => {
    const v = presentValuation(
      parse({
        tahmin: { deger_tl: null, birim_fiyat_tl_m2: null, emsal_adedi: 3 },
        fiyat_yayin: { guven_sinifi: "dusuk", guven_sunumu: { aralik_alt: 1_000_000, aralik_ust: 1_500_000, metin: "Veri sınırlı; yuvarlak aralık." } },
      }),
    );
    expect(v.dusukGuven).toBe(true);
    expect(v.baslik).toBe(EF_LOW_CONFIDENCE_TITLE);
    expect(v.sunumSatirlari.map((l) => l.value)).toEqual(["1.000.000 ₺", "1.500.000 ₺"]);
    expect(v.sunumMetinleri).toEqual(["Veri sınırlı; yuvarlak aralık."]);
    const text = JSON.stringify(v);
    expect(text).toContain("Kesin TL yok");
    expect(text).not.toMatch(/"value":"0 ₺"|bilinmiyor|"0"/i);
    expect(v.tahmin.find((l) => l.label === "Deger tl")?.value).toBe("Kesin TL yok");
    expect(v.tahmin.find((l) => l.label === "Emsal adedi")?.value).toBe("3");
  });

  it("sunucu K10'u uygulamasa bile düşük güvende sızan TL tutarı gösterilmez", () => {
    const v = presentValuation(parse({ tahmin: { deger_tl: 9_876_543 }, fiyat_yayin: { guven_sinifi: "dusuk", ilan_fiyat_ortalamasi: 5_555_555, guven_sunumu: { metin: "x" } } }));
    expect(JSON.stringify(v)).not.toMatch(/9\.876\.543|5\.555\.555/);
  });

  it("orta/yüksek güven: TL gösterilir, başlık yok; ilan fiyatı notu HER ZAMAN var; 'kesin değer/garanti' dili yok", () => {
    const v = presentValuation(parse({ tahmin: { deger_tl: 2_000_000 }, fiyat_yayin: { guven_sinifi: "yuksek" } }));
    expect(v.dusukGuven).toBe(false);
    expect(v.baslik).toBeNull();
    expect(v.guvenEtiketi).toBe("Güven: yüksek");
    expect(v.tahmin.map((l) => l.value)).toContain("2.000.000 ₺");
    expect(v.notlar).toContain(EF_LISTING_PRICE_NOTE);
    expect(EF_LISTING_PRICE_NOTE).toMatch(/ilan fiyatlarına dayanır/);
    expect(EF_LISTING_PRICE_NOTE).toMatch(/gerçekleşen satış fiyatı değildir/);
    expect(JSON.stringify(v)).not.toMatch(/kesin değer|garanti|hızlı satış/i);
  });

  it("rapor geçerlilik tarihi taşınır", () => {
    const v = presentValuation(parse({ rapor_gecerlilik: { gun: 30, expires_at: "2026-11-04T09:00:00.000Z" }, fiyat_yayin: { guven_sinifi: "orta" } }));
    expect(v.expiresAt).toBe("2026-11-04T09:00:00.000Z");
    expect(v.gecerlilikGun).toBe(30);
  });
});
