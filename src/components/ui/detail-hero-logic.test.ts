import { describe, expect, it } from "vitest";
import { DETAIL_HERO_MAX_ACTIONS, heroChipClass, heroTitleClass, heroTitleText, splitHeroActions } from "./detail-hero-logic";

describe("splitHeroActions (DetailHero eylem satırı taşması)", () => {
  it("en çok 4 eylem görünür, kalanlar 'Daha fazla'nın başına geçer (sıra korunur)", () => {
    const { visible, overflow } = splitHeroActions(["ara", "wa", "not", "randevu", "eslestir", "ilan"], ["vcf", "sil"]);
    expect(DETAIL_HERO_MAX_ACTIONS).toBe(4);
    expect(visible).toEqual(["ara", "wa", "not", "randevu"]);
    expect(overflow).toEqual(["eslestir", "ilan", "vcf", "sil"]);
  });

  it("koşullu boş yuvalar (null/false/undefined/'') sayılmaz; sıradaki eylem yukarı kayar", () => {
    const { visible, overflow } = splitHeroActions([null, "ara", false, undefined, "", "wa", "not", "randevu", "eslestir"], [null, "sil"]);
    expect(visible).toEqual(["ara", "wa", "not", "randevu"]);
    expect(overflow).toEqual(["eslestir", "sil"]);
  });

  it("4 ya da daha az eylemde menü boş kalır (gereksiz 'Daha fazla' çizilmez)", () => {
    expect(splitHeroActions(["a", "b"]).overflow).toEqual([]);
    expect(splitHeroActions(["a", "b", "c", "d"]).overflow).toEqual([]);
  });

  it("özel sınır: 0 ya da negatifte hepsi menüye gider; kesirli sınır aşağı yuvarlanır", () => {
    expect(splitHeroActions(["a", "b"], [], 0)).toEqual({ visible: [], overflow: ["a", "b"] });
    expect(splitHeroActions(["a", "b"], [], -3)).toEqual({ visible: [], overflow: ["a", "b"] });
    expect(splitHeroActions(["a", "b", "c"], [], 2.9)).toEqual({ visible: ["a", "b"], overflow: ["c"] });
  });

  it("yalnız seyrek eylem varsa satırda düğme yok, menü dolu", () => {
    expect(splitHeroActions([], ["sil"])).toEqual({ visible: [], overflow: ["sil"] });
  });
});

describe("başlık sığma kuralları", () => {
  it("1 satır: kırp + '…'; 2 satır: line-clamp + uzun kelime kırılır", () => {
    expect(heroTitleClass(1)).toBe("truncate");
    expect(heroTitleClass(2)).toContain("line-clamp-2");
    expect(heroTitleClass(2)).toContain("break-words");
  });

  it("title ipucu metni: boşluklar sadeleşir, boşsa yedek", () => {
    expect(heroTitleText("  Kadıköy   3+1\n Daire ", "x")).toBe("Kadıköy 3+1 Daire");
    expect(heroTitleText("   ", "Başlıksız kayıt")).toBe("Başlıksız kayıt");
    expect(heroTitleText(null, "PF-001")).toBe("PF-001");
  });
});

describe("heroChipClass", () => {
  it("her ton koyu cam tabanını taşır, tek satırdır ve bulanıklık kullanmaz (cam bütçesi)", () => {
    for (const tone of ["neutral", "good", "warn", "bad", "info", "gold"] as const) {
      const c = heroChipClass(tone);
      expect(c).toContain("rounded-full");
      expect(c).toContain("border");
      expect(c).not.toContain("backdrop-blur");
      expect(c).toContain("truncate");
    }
  });
});
