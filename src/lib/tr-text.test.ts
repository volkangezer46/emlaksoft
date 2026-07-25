import { describe, expect, it } from "vitest";
import { compareTr, foldTr, matchesTr, rankTr } from "./tr-text";

describe("foldTr", () => {
  it("Türkçe büyük İ'yi noktasız i'ye indirir", () => {
    // JS'in kendi toLowerCase()'i burada "i̇stanbul" üretir (birleşen nokta ile)
    // ve "istanbul" ile EŞLEŞMEZ. Bu testin varlık sebebi tam olarak bu.
    expect(foldTr("İstanbul")).toBe("istanbul");
    expect(foldTr("İSTANBUL")).toBe("istanbul");
    expect(foldTr("İstanbul")).toBe(foldTr("istanbul"));
  });

  it("noktasız I'yı ı'ya değil i'ye düzleştirir (arama için)", () => {
    // Türkçe kuralı "IĞDIR" -> "ığdır" der; kullanıcı "igdir" yazar.
    // Arama eşleşsin diye aksanlar da düzleştiriliyor.
    expect(foldTr("IĞDIR")).toBe("igdir");
    expect(foldTr("Iğdır")).toBe("igdir");
    expect(foldTr("ığdır")).toBe("igdir");
  });

  it("tüm Türkçe aksanlarını düzleştirir", () => {
    expect(foldTr("ÇŞĞÜÖİ")).toBe("csguoi");
    expect(foldTr("çşğüöı")).toBe("csguoi");
  });

  it("boşlukları sadeleştirir ve kırpar", () => {
    expect(foldTr("  Şişli   Mahallesi  ")).toBe("sisli mahallesi");
  });

  it("null/undefined/boş için boş dizge döner", () => {
    expect(foldTr(null)).toBe("");
    expect(foldTr(undefined)).toBe("");
    expect(foldTr("")).toBe("");
  });

  it("birleşen aksan kalıntısı bırakmaz", () => {
    // NFD sonrası temizlik yapılmazsa uzunluk beklenenden büyük olur.
    expect(foldTr("İ").length).toBe(1);
  });
});

describe("matchesTr", () => {
  it("Türkçe karakter duyarsız eşleşir", () => {
    expect(matchesTr("Kadıköy", "kadikoy")).toBe(true);
    expect(matchesTr("Kadıköy", "KADIKÖY")).toBe(true);
    expect(matchesTr("Şişli", "sisli")).toBe(true);
  });

  it("boş sorgu her şeyi eşler", () => {
    // Arama kutusu ilk açıldığında liste dolu görünsün diye.
    expect(matchesTr("herhangi", "")).toBe(true);
    expect(matchesTr(null, "")).toBe(true);
  });

  it("eşleşmeyeni reddeder", () => {
    expect(matchesTr("Kadıköy", "beşiktaş")).toBe(false);
  });

  it("null haystack'te boş olmayan sorgu eşleşmez", () => {
    expect(matchesTr(null, "abc")).toBe(false);
  });
});

describe("compareTr", () => {
  it("Türkçe alfabe sırasını uygular", () => {
    // Varsayılan localeCompare/`<` operatörü Ç'yi C'lerden hemen sonra
    // getirmez; Intl.Collator("tr") getirir.
    const sorted = ["Çankaya", "Ceyhan", "Dörtyol"].sort(compareTr);
    expect(sorted).toEqual(["Ceyhan", "Çankaya", "Dörtyol"]);
  });

  it("ı ve i'yi doğru sırada tutar", () => {
    const sorted = ["İzmir", "Isparta", "Iğdır"].sort(compareTr);
    expect(sorted).toEqual(["Iğdır", "Isparta", "İzmir"]);
  });

  it("null değerleri patlamadan sıralar", () => {
    expect(() => [null, "a", undefined].sort(compareTr)).not.toThrow();
  });
});

describe("rankTr", () => {
  const ilceler = [
    { name: "Beykadı" },
    { name: "Kadıköy" },
    { name: "Yeni Kadı Mahallesi" },
    { name: "Beşiktaş" },
  ];
  const label = (x: { name: string }) => x.name;

  it("baştan eşleşeni kelime-başı ve ortadaki eşleşmenin önüne alır", () => {
    const r = rankTr(ilceler, "kadi", label).map(label);
    expect(r[0]).toBe("Kadıköy"); // baştan
    expect(r).toContain("Yeni Kadı Mahallesi"); // kelime başı
    expect(r).toContain("Beykadı"); // ortada
    expect(r.indexOf("Yeni Kadı Mahallesi")).toBeLessThan(r.indexOf("Beykadı"));
  });

  it("eşleşmeyeni tamamen eler", () => {
    expect(rankTr(ilceler, "kadi", label).map(label)).not.toContain("Beşiktaş");
  });

  it("boş sorguda hepsini Türkçe alfabetik verir", () => {
    const r = rankTr(ilceler, "", label).map(label);
    expect(r).toHaveLength(4);
    expect(r[0]).toBe("Beşiktaş");
  });

  it("girdi dizisini değiştirmez", () => {
    const kopya = [...ilceler];
    rankTr(ilceler, "", label);
    expect(ilceler).toEqual(kopya);
  });
});
