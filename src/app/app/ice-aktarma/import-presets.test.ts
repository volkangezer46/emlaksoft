import { describe, expect, it } from "vitest";
import {
  CUSTOMER_FIELDS,
  DEMAND_FIELDS,
  FIELD_GROUPS,
  PROPERTY_FIELDS,
  detectPreset,
  googleContactsToTable,
  guessMapping,
  promoteHeaderRow,
} from "./import-config";

describe("hazır biçimler", () => {
  it("sahibinden mağaza Excel başlıkları tanınır ve genişletilmiş alanlara eşlenir", () => {
    const headers = ["İlan No", "İlan Başlığı", "Fiyat", "İl", "İlçe", "Mahalle", "m² (Brüt)", "m² (Net)", "Oda Sayısı", "Bina Yaşı", "Bulunduğu Kat", "Isıtma", "Kategori", "Açıklama"];
    expect(detectPreset(headers)?.id).toBe("sahibinden");
    const m = guessMapping(headers, PROPERTY_FIELDS);
    expect(m).toMatchObject({
      portal_listing_no: 0,
      title: 1,
      list_price: 2,
      province: 3,
      district: 4,
      neighborhood: 5,
      sqm: 6,
      net_sqm: 7,
      rooms: 8,
      building_age: 9,
      floor: 10,
      heating: 11,
      property_type: 12,
      description: 13,
    });
  });

  it("malik / danışman / fotoğraf sütunları eşlenir", () => {
    const m = guessMapping(["Başlık", "Mal Sahibi", "Mal Sahibi Telefonu", "Danışman", "Fotoğraflar"], PROPERTY_FIELDS);
    expect(m).toMatchObject({ title: 0, owner_name: 1, owner_phone: 2, advisor: 3, photo_urls: 4 });
  });

  it("Google Kişiler CSV'si tanınır, ad bileşik sütundan, cep numarası öncelikli", () => {
    const headers = ["First Name", "Middle Name", "Last Name", "Notes", "Labels", "E-mail 1 - Value", "Phone 1 - Label", "Phone 1 - Value", "Phone 2 - Label", "Phone 2 - Value", "Address 1 - City"];
    expect(detectPreset(headers)?.id).toBe("google-contacts");
    const t = googleContactsToTable({
      headers,
      rows: [["Ayşe", "", "Yılmaz", "3+1", "* myContacts ::: Alıcı", "ayse@example.com", "Home", "0216 333 44 55", "Mobile", "0532 123 45 67 ::: 0533 000 00 00", "Kadıköy"]],
    });
    expect(t.rows[0]).toEqual(["Ayşe Yılmaz", "0532 123 45 67", "ayse@example.com", "3+1", "* myContacts ::: Alıcı", "Kadıköy"]);
    expect(guessMapping(t.headers, CUSTOMER_FIELDS)).toMatchObject({ full_name: 0, phone: 1, email: 2, notes: 3, tags: 4, city: 5 });
  });

  it("tanınmayan dosya null döner", () => {
    expect(detectPreset(["Ad", "Telefon"])).toBeNull();
  });

  it("üstteki başlık/tarih satırı atlanır", () => {
    const t = promoteHeaderRow({ headers: ["Mağaza İlanları 15.10.2026", "", ""], rows: [["", "", ""], ["İlan No", "Başlık", "Fiyat"], ["1", "Daire", "100"]] });
    expect(t.headers).toEqual(["İlan No", "Başlık", "Fiyat"]);
    expect(t.rows).toEqual([["1", "Daire", "100"]]);
    const same = { headers: ["A", "B"], rows: [["1", "2"]] };
    expect(promoteHeaderRow(same)).toBe(same);
  });

  it("talepte bölge sütunu, gruplar tüm portföy alanlarını kapsar", () => {
    expect(guessMapping(["Telefon", "Aranan Bölge"], DEMAND_FIELDS)).toMatchObject({ customer_phone: 0, location: 1 });
    const grouped = FIELD_GROUPS.properties!.flatMap((g) => g.keys).sort();
    expect(grouped).toEqual(PROPERTY_FIELDS.map((f) => f.key).sort());
  });
});
