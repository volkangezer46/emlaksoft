import { describe, expect, it } from "vitest";
import { editDistance, extractNumbers, parseNlQuery, type NlGeo } from "./parse";

const GEO: NlGeo = {
  provinces: [
    { id: "p-ist", name: "İstanbul" },
    { id: "p-ank", name: "Ankara" },
    { id: "p-kms", name: "Kahramanmaraş" },
    { id: "p-igd", name: "Iğdır" },
  ],
  districts: [
    { id: "d-kad", name: "Kadıköy", parentId: "p-ist" },
    { id: "d-sis", name: "Şişli", parentId: "p-ist" },
    { id: "d-cnk", name: "Çankaya", parentId: "p-ank" },
    { id: "d-oni", name: "Onikişubat", parentId: "p-kms" },
    { id: "d-dul", name: "Dulkadiroğlu", parentId: "p-kms" },
    { id: "d-mrk1", name: "Merkez", parentId: "p-igd" },
    { id: "d-mrk2", name: "Merkez", parentId: "p-ank" },
  ],
};

const NEIGH = [
  { id: "n-fev", name: "Fevzi Çakmak", parentId: "d-kad" },
  { id: "n-moda", name: "Moda", parentId: "d-kad" },
  { id: "n-cal", name: "Caferağa", parentId: "d-kad" },
];

describe("extractNumbers", () => {
  it("oda sayısını okur", () => {
    expect(extractNumbers("3+1 daire").rooms).toEqual(["3+1"]);
    expect(extractNumbers("2+1 veya 3+1").rooms).toEqual(["2+1", "3+1"]);
    expect(extractNumbers("studyo daire").rooms).toEqual(["1+0"]);
  });

  it("milyon/bin yazımlarını sayıya çevirir", () => {
    expect(extractNumbers("2 milyon").money).toEqual({ max: 2_000_000, assumed: true });
    expect(extractNumbers("2,5 milyon alti").money).toEqual({ max: 2_500_000 });
    expect(extractNumbers("2.5 milyon altinda").money).toEqual({ max: 2_500_000 });
    expect(extractNumbers("500 bin ustu").money).toEqual({ min: 500_000 });
    expect(parseNlQuery("500bin tl'den fazla").filters.fiyat_min).toBe("500000");
    expect(extractNumbers("2 bucuk milyon alti").money).toEqual({ max: 2_500_000 });
    expect(extractNumbers("1.500.000 tl alti").money).toEqual({ max: 1_500_000 });
    expect(extractNumbers("25000 tl alti").money).toEqual({ max: 25_000 });
  });

  it("aralık ve önek yönlerini ayırır", () => {
    expect(extractNumbers("1 ile 2 milyon arasi").money).toEqual({ min: 1_000_000, max: 2_000_000 });
    expect(extractNumbers("1-2 milyon").money).toEqual({ min: 1_000_000, max: 2_000_000 });
    expect(extractNumbers("500 bin ile 1 milyon arasinda").money).toEqual({ min: 500_000, max: 1_000_000 });
    expect(extractNumbers("en az 3 milyon").money).toEqual({ min: 3_000_000 });
    expect(extractNumbers("en fazla 4 milyon").money).toEqual({ max: 4_000_000 });
    expect(extractNumbers("max 4 milyon").money).toEqual({ max: 4_000_000 });
    expect(extractNumbers("3 milyon civari").money).toEqual({ min: 2_700_000, max: 3_300_000 });
  });

  it("metrekare aralıklarını okur", () => {
    expect(extractNumbers("100 m2 ustu").area).toEqual({ min: 100 });
    expect(extractNumbers("100-150 m2").area).toEqual({ min: 100, max: 150 });
    expect(extractNumbers("120 metrekare alti").area).toEqual({ max: 120 });
    expect(extractNumbers("en az 90 m2").area).toEqual({ min: 90 });
  });

  it("katı okur", () => {
    expect(extractNumbers("3. kat").floor).toEqual({ min: 3, max: 3 });
    expect(extractNumbers("en az 3. kat").floor).toEqual({ min: 3 });
    expect(extractNumbers("zemin kat").floor).toEqual({ min: 0, max: 0 });
    expect(extractNumbers("2-4. kat").floor).toEqual({ min: 2, max: 4 });
  });

  it("fiyatı alana, alanı fiyata karıştırmaz", () => {
    const r = extractNumbers("100 m2 2 milyon alti 3+1");
    expect(r.area).toEqual({ min: 90, max: 110, assumed: true });
    expect(r.money).toEqual({ max: 2_000_000 });
    expect(r.rooms).toEqual(["3+1"]);
  });
});

describe("parseNlQuery - örnek cümleler", () => {
  it("Onikişubat 3+1 satılık 2 milyon altı", () => {
    const r = parseNlQuery("Onikişubat 3+1 satılık 2 milyon altı", GEO);
    expect(r.target).toBe("portfoy");
    expect(r.filters).toMatchObject({
      islem: "Satılık",
      oda: "3+1",
      fiyat_max: "2000000",
      ilce: "d-oni",
    });
    expect(r.unknown).toEqual([]);
  });

  it("ASCII yazımı (Turkce karaktersiz) aynı sonucu verir", () => {
    const r = parseNlQuery("onikisubat 3+1 satilik 2 milyon alti", GEO);
    expect(r.filters.ilce).toBe("d-oni");
    expect(r.filters.islem).toBe("Satılık");
  });

  it("Kadıköy'de kiralık 2+1 daire 30 bin altı", () => {
    const r = parseNlQuery("Kadıköy'de kiralık 2+1 daire 30 bin altı", GEO);
    expect(r.filters).toMatchObject({ islem: "Kiralık", kategori: "Daire", oda: "2+1", fiyat_max: "30000", ilce: "d-kad" });
  });

  it("ilçeden ili türetir ve chip'te il adını gösterir", () => {
    const r = parseNlQuery("kadikoy satilik", GEO);
    const chip = r.chips.find((c) => c.group === "ilce");
    expect(chip?.label).toBe("Kadıköy (İstanbul)");
    expect(r.provinceId).toBe("p-ist");
  });

  it("il yazılırsa il filtresi kullanılır", () => {
    const r = parseNlQuery("Ankara satılık villa", GEO);
    expect(r.filters).toMatchObject({ il: "p-ank", islem: "Satılık", kategori: "Villa" });
    expect(r.filters.ilce).toBeUndefined();
  });

  it("il + ilçe birlikte", () => {
    const r = parseNlQuery("İstanbul Şişli kiralık daire", GEO);
    expect(r.filters).toMatchObject({ il: "p-ist", ilce: "d-sis" });
  });

  it("yazım toleransı: Kadiköy / Kadikoyy / Cankaya", () => {
    expect(parseNlQuery("kadikoyy 2+1", GEO).filters.ilce).toBe("d-kad");
    expect(parseNlQuery("cankya satilik", GEO).filters.ilce).toBe("d-cnk");
    expect(parseNlQuery("satlik daire", GEO).filters.islem).toBe("Satılık");
  });

  it("kısa sözcüklerde tolerans yoktur", () => {
    const r = parseNlQuery("ofis arsa", GEO);
    expect(r.filters.il).toBeUndefined();
  });

  it("arasi: 1 ile 2 milyon arası satılık daire", () => {
    const r = parseNlQuery("1 ile 2 milyon arası satılık daire", GEO);
    expect(r.filters).toMatchObject({ fiyat_min: "1000000", fiyat_max: "2000000", kategori: "Daire" });
  });

  it("ustu: 5 milyon üstü villa", () => {
    const r = parseNlQuery("5 milyon üstü villa", GEO);
    expect(r.filters).toMatchObject({ fiyat_min: "5000000", kategori: "Villa" });
    expect(r.filters.fiyat_max).toBeUndefined();
  });

  it("metrekare ve kat birlikte", () => {
    const r = parseNlQuery("Çankaya 120 m2 üstü 3. kat 3+1", GEO);
    expect(r.filters).toMatchObject({ m2_min: "120", kat_min: "3", kat_max: "3", oda: "3+1", ilce: "d-cnk" });
  });

  it("müstakil ev ve işyeri türleri", () => {
    expect(parseNlQuery("müstakil ev satılık", GEO).filters.kategori).toBe("Müstakil ev");
    expect(parseNlQuery("iş yeri kiralık", GEO).filters.kategori).toBe("İşyeri");
    expect(parseNlQuery("dükkan kiralık", GEO).filters.kategori).toBe("Dükkan");
  });

  it("çoğul/iyelik ekli tür: daireler, arsalar", () => {
    expect(parseNlQuery("satılık daireler", GEO).filters.kategori).toBe("Daire");
    expect(parseNlQuery("arsa", GEO).filters.kategori).toBe("Arsa");
  });

  it("birden çok oda", () => {
    const r = parseNlQuery("2+1 veya 3+1 satılık", GEO);
    expect(r.filters.oda).toBe("2+1,3+1");
  });

  it("çelişen işlem türü uyarı verir, filtre koymaz", () => {
    const r = parseNlQuery("satılık kiralık daire", GEO);
    expect(r.filters.islem).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/satılık hem kiralık/);
  });

  it("belirsiz ilçe (Merkez) filtre uygulamaz", () => {
    const r = parseNlQuery("merkez satılık", GEO);
    expect(r.filters.ilce).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/birden çok ilçe/);
  });

  it("il verilince Merkez ilçesi o ile daralır", () => {
    const r = parseNlQuery("ankara merkez satılık", GEO);
    expect(r.filters).toMatchObject({ il: "p-ank", ilce: "d-mrk2" });
  });

  it("mahalle, ilçenin mahalle listesi verilince eşlenir", () => {
    const r = parseNlQuery("Kadıköy Fevzi Çakmak mahallesi 2+1", { ...GEO, neighborhoods: NEIGH });
    expect(r.filters).toMatchObject({ ilce: "d-kad", mahalle: "n-fev", oda: "2+1" });
    const r2 = parseNlQuery("kadıköy moda satılık", { ...GEO, neighborhoods: NEIGH });
    expect(r2.filters.mahalle).toBe("n-moda");
  });

  it("anlaşılamayan sözcükleri uydurmadan listeler", () => {
    const r = parseNlQuery("Kadıköy asansörlü 3+1 manzaralı", GEO);
    expect(r.unknown).toEqual(expect.arrayContaining(["manzarali"]));
    expect(r.filters.ilce).toBe("d-kad");
  });

  it("talep ve müşteri hedefleri", () => {
    expect(parseNlQuery("Kadıköy 3+1 arayan talepler", GEO).target).toBe("talep");
    expect(parseNlQuery("Ankara müşteriler", GEO).target).toBe("musteri");
  });

  it("haric: kullanıcının kaldırdığı chip filtreden çıkar, geri alınabilir listede kalır", () => {
    const r = parseNlQuery("Kadıköy 3+1 satılık 2 milyon altı", GEO, { exclude: ["fiyat", "oda"] });
    expect(r.filters.fiyat_max).toBeUndefined();
    expect(r.filters.oda).toBeUndefined();
    expect(r.filters.ilce).toBe("d-kad");
    expect(r.excluded.map((c) => c.group).sort()).toEqual(["fiyat", "oda"]);
  });

  it("boş ve anlamsız metin filtre üretmez", () => {
    expect(parseNlQuery("", GEO).chips).toEqual([]);
    expect(parseNlQuery("   ", GEO).chips).toEqual([]);
    expect(parseNlQuery("merhaba nasılsın", GEO).chips).toEqual([]);
  });

  it("varsayım chip'i işaretlenir", () => {
    const r = parseNlQuery("Kadıköy 2 milyon", GEO);
    expect(r.chips.find((c) => c.group === "fiyat")?.assumed).toBe(true);
    const r2 = parseNlQuery("Kadıköy 2 milyon altı", GEO);
    expect(r2.chips.find((c) => c.group === "fiyat")?.assumed).toBeUndefined();
  });

  it("chip etiketleri Türkçe ve okunur", () => {
    const r = parseNlQuery("2,5 milyon altı 100 m2 üstü", GEO);
    expect(r.chips.find((c) => c.group === "fiyat")?.label).toBe("En çok 2,5 Mn TL");
    expect(r.chips.find((c) => c.group === "m2")?.label).toBe("En az 100 m²");
  });

  it("kişisel veri benzeri uzun sayı fiyat sanılmaz telefon biçiminde kalır", () => {
    const r = parseNlQuery("0532 123 45 67", GEO);
    expect(r.filters.fiyat_max).toBeUndefined();
  });
});

describe("editDistance", () => {
  it("temel durumlar", () => {
    expect(editDistance("kadikoy", "kadikoy")).toBe(0);
    expect(editDistance("kadikoy", "kadikoyy")).toBe(1);
    expect(editDistance("abc", "xyzxyz", 2)).toBeGreaterThan(2);
  });
});
