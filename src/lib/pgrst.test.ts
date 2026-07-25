import { describe, expect, it } from "vitest";
import { inFilter, orIlike, safeLike } from "./pgrst";

/**
 * Bu testler bir GÜVENLİK/DOĞRULUK sınırını koruyor: kullanıcı metni
 * PostgREST'in `or=(...)` gramerine gömülüyor. Virgül ayraç, parantez
 * gruplama, nokta operatör ayracıdır; `%` ve `_` ise LIKE jokerleridir.
 * Bunlardan biri sızarsa sorgu ya patlar ya da beklenenden fazla satır döner.
 */

describe("safeLike", () => {
  it("PostgREST gramerini bozan karakterleri temizler", () => {
    for (const ch of [",", ".", "(", ")", ":", "*", "\\", '"']) {
      expect(safeLike(`ab${ch}cd`)).toBe("%ab cd%");
    }
  });

  it("LIKE jokerlerini temizler", () => {
    // Bu düzeltilmeden önce `%` yazan kullanıcı TÜM kayıtları çekebiliyordu.
    // Yalnizca joker yazilirsa geriye bos desen kalir (bosluk sadelestirme +
    // trim). "%%" tum kayitlari eslesir ama bu bos sorguyla ayni davranis;
    // kullaniciya fazladan bir sey acmiyor.
    expect(safeLike("%")).toBe("%%");
    expect(safeLike("a%b_c")).toBe("%a b c%");
  });

  it("çoklu boşluğu sadeleştirir ve kırpar", () => {
    expect(safeLike("  ali   veli  ")).toBe("%ali veli%");
  });

  it("uzunluğu sınırlar", () => {
    const uzun = "a".repeat(500);
    expect(safeLike(uzun).length).toBe(80 + 2); // %...%
    expect(safeLike(uzun, 10)).toBe(`%${"a".repeat(10)}%`);
  });

  it("Türkçe karakterlere dokunmaz", () => {
    expect(safeLike("Şişli Çağlayan")).toBe("%Şişli Çağlayan%");
  });

  it("boş girdide de geçerli bir desen üretir", () => {
    expect(safeLike("")).toBe("%%");
  });
});

describe("orIlike", () => {
  it("her kolon için tırnaklı ilike koşulu üretir", () => {
    expect(orIlike(["a", "b"], "ev")).toBe('a.ilike."%ev%",b.ilike."%ev%"');
  });

  it("üretilen dizgede kaçmış ayraç bırakmaz", () => {
    // Kullanıcı virgül yazarsa koşul sayısı değişmemeli.
    const out = orIlike(["title"], "a,b(c)");
    expect(out).toBe('title.ilike."%a b c%"');
    // Kolon sayısı kadar koşul: tırnak dışında virgül yok.
    expect(out.split('.ilike."').length - 1).toBe(1);
  });

  it("değeri çift tırnak içine alır (boşluk ayraç sanılmasın)", () => {
    expect(orIlike(["full_name"], "ali veli")).toBe('full_name.ilike."%ali veli%"');
  });
});

describe("inFilter", () => {
  const uuid = "6cfb873d-a919-405a-83f3-9770f4d7049f";

  it("geçerli uuid listesinden in koşulu üretir", () => {
    expect(inFilter("district_id", [uuid])).toBe(`district_id.in.(${uuid})`);
  });

  it("boş listede null döner", () => {
    // `in.()` PostgREST'te sözdizimi hatası; koşul hiç eklenmemeli.
    expect(inFilter("district_id", [])).toBeNull();
  });

  it("uuid olmayan değerleri eler", () => {
    expect(inFilter("id", ["' or 1=1--", uuid])).toBe(`id.in.(${uuid})`);
  });

  it("hepsi geçersizse null döner", () => {
    expect(inFilter("id", ["abc", ""])).toBeNull();
  });
});
