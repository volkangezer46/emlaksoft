import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_BODY_MAX,
  TEMPLATE_VARIABLES,
  VARIABLE_HELP,
  isTemplateCategory,
  renderTemplate,
  usedVariables,
} from "@/lib/message-templates";

describe("renderTemplate", () => {
  it("bilinen değişkenleri verilen değerlerle değiştirir", () => {
    const out = renderTemplate("Merhaba {musteri}, ben {ofis}'ten {danisman}.", {
      musteri: "Ayşe Yılmaz",
      ofis: "Vadi Emlak",
      danisman: "Mehmet Demir",
    });
    expect(out).toBe("Merhaba Ayşe Yılmaz, ben Vadi Emlak'ten Mehmet Demir.");
  });

  it("eksik değişkeni boş string yapar ve çift boşluk bırakmaz", () => {
    const out = renderTemplate("Merhaba {musteri} {danisman} bey, iyi günler.", {
      musteri: "Ayşe",
    });
    expect(out).toBe("Merhaba Ayşe bey, iyi günler.");
    expect(out).not.toMatch(/ {2}/);
  });

  it("değişken tamamen boşken öksüz noktalama ve parantez bırakmaz", () => {
    const out = renderTemplate("{portfoy} ({portfoy_kodu}) ilanı, {musteri} .", {});
    expect(out).toBe("ilanı,.");
    expect(out).not.toContain("()");
  });

  it("bilinmeyen yer tutucuyu aynen korur", () => {
    const out = renderTemplate("Sayın {musteri}, {kampanya_adi} kampanyası ve {MUSTERI}.", {
      musteri: "Ali",
    });
    expect(out).toContain("{kampanya_adi}");
    expect(out).toContain("{MUSTERI}");
    expect(out).toContain("Sayın Ali");
  });

  it("çok satırlı gövdede satır yapısını korur, fazla boş satırı sadeleştirir", () => {
    const body = "Merhaba {musteri},\n\n\n\nRandevu: {randevu_tarih} {randevu_saat}\nAdres: {adres}";
    const out = renderTemplate(body, {
      musteri: "Ayşe",
      randevu_tarih: "12 Ağustos",
      randevu_saat: "14:30",
      adres: "Çankaya",
    });
    expect(out).toBe("Merhaba Ayşe,\n\nRandevu: 12 Ağustos 14:30\nAdres: Çankaya");
    expect(out.split("\n")).toHaveLength(4);
  });

  it("baş/son boşlukları ve satır sonu boşluklarını temizler", () => {
    const out = renderTemplate("   Merhaba {musteri}   \n   İyi günler.   ", { musteri: "Ali" });
    expect(out).toBe("Merhaba Ali\nİyi günler.");
  });

  it("null/undefined değerleri boş sayar, değerlerin kendi boşluğunu kırpar", () => {
    const out = renderTemplate("{musteri} — {danisman} — {ofis}", {
      musteri: "  Ayşe  ",
      danisman: null,
      ofis: undefined,
    });
    expect(out).toBe("Ayşe — —");
  });

  it("boş gövdede boş string döner", () => {
    expect(renderTemplate("", { musteri: "Ali" })).toBe("");
  });

  it("değişken değerinin içindeki yer tutucuyu tekrar işlemez", () => {
    const out = renderTemplate("Merhaba {musteri}", { musteri: "{danisman}", danisman: "Mehmet" });
    expect(out).toBe("Merhaba {danisman}");
  });

  it("render sonucu şablon sınırını aşmaz (tipik en uzun varsayılan + örnek değerler)", () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body.length).toBeLessThanOrEqual(TEMPLATE_BODY_MAX);
      const rendered = renderTemplate(t.body, {
        musteri: "Ayşe Yılmaz",
        danisman: "Mehmet Demir",
        ofis: "Vadi Emlak",
        portfoy: "3+1 Bahçe Katı Daire",
        portfoy_kodu: "VD-1042",
        fiyat: "4.750.000 ₺",
        adres: "Çankaya / Birlik Mahallesi",
        randevu_tarih: "12 Ağustos Salı",
        randevu_saat: "14:30",
        link: "https://emlaksoft.vercel.app/vitrin/vadi-emlak/1042",
        telefon: "0532 123 45 67",
      });
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered).not.toMatch(/\{(musteri|danisman|ofis|portfoy|fiyat|adres|link|telefon)\}/);
    }
  });
});

describe("usedVariables", () => {
  it("gövdedeki bilinen değişkenleri tekilleştirip sözlük sırasında döner", () => {
    expect(usedVariables("{danisman} {musteri} {musteri} {bilinmeyen}")).toEqual(["musteri", "danisman"]);
  });

  it("değişkensiz gövdede boş dizi döner", () => {
    expect(usedVariables("Merhaba, iyi günler.")).toEqual([]);
  });
});

describe("sabitler", () => {
  it("VARIABLE_HELP tüm değişkenleri kapsar ve token'ları tutarlıdır", () => {
    expect(VARIABLE_HELP.map((v) => v.key)).toEqual([...TEMPLATE_VARIABLES]);
    for (const v of VARIABLE_HELP) expect(v.token).toBe(`{${v.key}}`);
  });

  it("varsayılan şablon seti en az 8 kayıt içerir ve kategorileri geçerlidir", () => {
    expect(DEFAULT_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const t of DEFAULT_TEMPLATES) {
      expect(isTemplateCategory(t.category)).toBe(true);
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  it("isTemplateCategory geçersiz değeri reddeder", () => {
    expect(isTemplateCategory("mor")).toBe(false);
    expect(isTemplateCategory(null)).toBe(false);
  });
});
