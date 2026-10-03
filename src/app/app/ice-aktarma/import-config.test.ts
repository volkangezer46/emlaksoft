import { describe, expect, it } from "vitest";
import {
  CUSTOMER_FIELDS,
  DEMAND_FIELDS,
  PROPERTY_FIELDS,
  guessMapping,
  parseCsv,
} from "./import-config";

describe("guessMapping — Türkçe başlık eşanlamlıları", () => {
  it("müşteri başlıklarını (aksan/büyük harf farkına rağmen) eşler", () => {
    const headers = ["ADI SOYADI", "Cep Telefonu", "E-Posta Adresi", "Müşteri Tipi", "Nereden Geldi", "Açıklama"];
    const m = guessMapping(headers, CUSTOMER_FIELDS);
    expect(m).toEqual({ full_name: 0, phone: 1, email: 2, customer_type: 3, source: 4, notes: 5 });
  });

  it("'ad' ipucu 'adres' başlığına yapışmaz", () => {
    const m = guessMapping(["Adres", "Başlık"], PROPERTY_FIELDS);
    expect(m.address_line).toBe(0);
    expect(m.title).toBe(1);
  });

  it("portföy başlıkları: fiyat, m², oda, işlem", () => {
    const m = guessMapping(["İlan Başlığı", "Satılık/Kiralık", "Emlak Tipi", "Fiyat", "Oda Sayısı", "Brüt m2", "Açık Adres"], PROPERTY_FIELDS);
    expect(m).toEqual({ title: 0, transaction_type: 1, property_type: 2, list_price: 3, rooms: 4, sqm: 5, address_line: 6 });
  });

  it("talep: min/maks bütçe doğru ayrışır; bir başlık iki alana gitmez", () => {
    const m = guessMapping(["Telefon", "İşlem Türü", "Min Bütçe", "Max Bütçe", "Oda"], DEMAND_FIELDS);
    expect(m.budget_min).toBe(2);
    expect(m.budget_max).toBe(3);
    expect(m.customer_phone).toBe(0);
    expect(new Set(Object.values(m)).size).toBe(Object.values(m).length);
  });

  it("tanınmayan başlıklar eşlenmez", () => {
    expect(guessMapping(["xyz", "abc"], CUSTOMER_FIELDS)).toEqual({});
  });
});

describe("parseCsv", () => {
  it("noktalı virgül ayracı, tırnaklı alan ve BOM'u çözer", () => {
    const p = parseCsv('﻿Ad;Not\nAli;"a;b ""c"""\n\nVeli;x\n');
    expect(p.delimiter).toBe(";");
    expect(p.headers).toEqual(["Ad", "Not"]);
    expect(p.rows).toEqual([
      ["Ali", 'a;b "c"'],
      ["Veli", "x"],
    ]);
  });
});
