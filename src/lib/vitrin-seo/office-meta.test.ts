import { describe, expect, it } from "vitest";
import { mergePatterns } from "@/lib/seo/schema";
import { vitrinOfficeMeta } from "./office-meta";

const vars = { ofis: "Gezer Emlak", ilan_sayisi: 12 };
const patterns = mergePatterns(null);

describe("vitrin SEO metni: elle metin önce, kalıp geri düşüş", () => {
  it("elle başlık ve açıklama varsa onlar kullanılır", () => {
    const m = vitrinOfficeMeta({ seoTitle: "Kadıköy satılık daireler", seoDescription: "Kadıköy ve Moda'da satılık daireler.", intro: "Tanıtım", patterns, vars });
    expect(m).toEqual({ title: "Kadıköy satılık daireler", description: "Kadıköy ve Moda'da satılık daireler." });
  });

  it("elle metin yoksa başlık kalıptan, açıklama tanıtım metninden", () => {
    const m = vitrinOfficeMeta({ seoTitle: null, seoDescription: null, intro: "Satılık  ve\n kiralık", patterns, vars });
    expect(m.title).toBe("Gezer Emlak | Portföy Vitrini");
    expect(m.description).toBe("Satılık ve kiralık");
  });

  it("tanıtım da yoksa açıklama kalıptan; yalnız boşluk olan elle metin yok sayılır", () => {
    const m = vitrinOfficeMeta({ seoTitle: "   ", seoDescription: "\n\t ", intro: null, patterns, vars });
    expect(m.title).toBe("Gezer Emlak | Portföy Vitrini");
    expect(m.description).toContain("12 aktif ilan");
  });

  it("yalnız biri doluysa diğeri geri düşer", () => {
    const m = vitrinOfficeMeta({ seoTitle: null, seoDescription: "Elle açıklama", intro: "Tanıtım", patterns, vars });
    expect(m.title).toBe("Gezer Emlak | Portföy Vitrini");
    expect(m.description).toBe("Elle açıklama");
  });

  it("sınırı aşan (bozuk) değer sınırda kesilir", () => {
    const m = vitrinOfficeMeta({ seoTitle: "a".repeat(90), seoDescription: "b".repeat(200), intro: null, patterns, vars });
    expect(m.title).toHaveLength(70);
    expect(m.description).toHaveLength(160);
  });
});
