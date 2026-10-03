import { describe, expect, it } from "vitest";
import {
  buildCustomerLookup,
  buildIssueCsv,
  countPlanned,
  planCustomerRows,
  planDemandRows,
  planPropertyRows,
  parseTurkishNumber,
  propertyKey,
  validateCustomerRow,
  validateDemandRow,
  validatePropertyRow,
  type ExistingCustomer,
  type ExistingProperty,
} from "./import-rows";

const existingAyse: ExistingCustomer = {
  id: "c-ayse",
  full_name: "Ayşe Yılmaz",
  phone: "05321234567",
  email: "ayse@example.com",
  customer_types: ["Alıcı"],
  source: "Referans",
  notes: null,
};

describe("validateCustomerRow", () => {
  it("telefonu parsePhone ile normalize eder, e-postayı küçültür", () => {
    const v = validateCustomerRow({ row: 2, full_name: " Ali ", phone: "+90 532 123 45 67", email: " ALI@Example.COM " });
    expect(v.data).toMatchObject({ full_name: "Ali", phone: "05321234567", email: "ali@example.com" });
    expect(v.issues).toEqual([]);
  });

  it("zorunlu alan, geçersiz telefon ve e-posta hata verir", () => {
    expect(validateCustomerRow({ row: 2, full_name: "" }).issues[0].message).toMatch(/Ad soyad/);
    expect(validateCustomerRow({ row: 2, full_name: "A", phone: "xyz" }).data).toBeUndefined();
    expect(validateCustomerRow({ row: 2, full_name: "A", email: "bozuk" }).issues[0].level).toBe("error");
  });

  it("telefon ve e-posta yoksa uyarı verir ama hata değildir", () => {
    const v = validateCustomerRow({ row: 2, full_name: "A" });
    expect(v.data).toBeDefined();
    expect(v.issues).toHaveLength(1);
    expect(v.issues[0].level).toBe("warning");
  });

  it("müşteri tipini tanım listesindeki yazıma çevirir", () => {
    expect(validateCustomerRow({ row: 2, full_name: "A", phone: "05321234567", customer_type: "alıcı" }).data?.customer_type).toBe("Alıcı");
  });
});

describe("planCustomerRows (mükerrer politikası)", () => {
  const lookup = buildCustomerLookup([existingAyse]);
  const rows = [
    { row: 2, full_name: "Ayşe Y.", phone: "0532 123 45 67" }, // telefonla mevcut
    { row: 3, full_name: "Ayşe", email: "AYSE@example.com" }, // e-postayla mevcut
    { row: 4, full_name: "Yeni Kişi", phone: "0555 111 22 33" },
    { row: 5, full_name: "Yeni Kişi Kopya", phone: "+90 555 111 22 33" }, // dosya içi tekrar
    { row: 6, full_name: "", phone: "0555 000 00 00" }, // hata
  ];

  it("atla: mevcut ve dosya içi tekrarlar atlanır, yeni olan eklenir, hata sayılır", () => {
    const planned = planCustomerRows(rows, lookup, "skip");
    expect(planned.map((p) => p.status)).toEqual(["skip", "skip", "new", "skip", "error"]);
    expect(planned[0].matchedBy).toBe("telefon");
    expect(planned[1].matchedBy).toBe("e-posta");
    expect(countPlanned(planned)).toMatchObject({ total: 5, new: 1, skip: 3, error: 1 });
  });

  it("güncelle: mevcut kayıt yamalanır ve eski değerler saklanır", () => {
    const planned = planCustomerRows(
      [{ row: 2, full_name: "Ayşe Yılmaz", phone: "05321234567", email: "yeni@example.com", customer_type: "Yatırımcı", notes: "VIP" }],
      lookup,
      "update",
    );
    expect(planned[0].status).toBe("update");
    expect(planned[0].existingId).toBe("c-ayse");
    expect(planned[0].patch).toEqual({
      email: "yeni@example.com",
      notes: "VIP",
      customer_types: ["Alıcı", "Yatırımcı"],
    });
    expect(planned[0].prev).toEqual({ email: "ayse@example.com", notes: null, customer_types: ["Alıcı"] });
  });

  it("güncelle: değişiklik yoksa atlanır; dosya içi tekrarda ilk satır kazanır", () => {
    const planned = planCustomerRows(
      [
        { row: 2, full_name: "Ayşe Yılmaz", phone: "05321234567" },
        { row: 3, full_name: "Yeni", phone: "05551112233" },
        { row: 4, full_name: "Yeni 2", phone: "05551112233" },
      ],
      lookup,
      "update",
    );
    expect(planned.map((p) => p.status)).toEqual(["skip", "new", "skip"]);
  });

  it("yeni oluştur: mevcut olsa da yeni kayıt açar (uyarıyla), dosya içi tekrar da açılır", () => {
    const planned = planCustomerRows(
      [
        { row: 2, full_name: "Ayşe", phone: "05321234567" },
        { row: 3, full_name: "Ayşe 2", phone: "05321234567" },
      ],
      lookup,
      "create",
    );
    expect(planned.map((p) => p.status)).toEqual(["new", "new"]);
    expect(planned[0].issues.some((i) => i.level === "warning")).toBe(true);
  });

  it("parçalar arası dosya içi tekrar `seen` ile yakalanır", () => {
    const seen = new Set<string>();
    planCustomerRows([{ row: 2, full_name: "A", phone: "05551112233" }], buildCustomerLookup([]), "skip", seen);
    const second = planCustomerRows([{ row: 300, full_name: "B", phone: "05551112233" }], buildCustomerLookup([]), "skip", seen);
    expect(second[0].status).toBe("skip");
  });
});

describe("portföy", () => {
  it("fiyat/tür doğrulaması ve varsayılan uyarıları", () => {
    expect(validatePropertyRow({ row: 2, title: "" }).data).toBeUndefined();
    expect(validatePropertyRow({ row: 2, title: "X", list_price: "abc" }).issues[0].message).toMatch(/Fiyat/);
    const v = validatePropertyRow({ row: 2, title: "X", list_price: "4.500.000", transaction_type: "satis", sqm: "125" });
    expect(v.data).toMatchObject({ list_price: 4500000, transaction_type: "Satılık", sqm: 125 });
    const d = validatePropertyRow({ row: 2, title: "X", list_price: "1" });
    expect(d.issues.filter((i) => i.level === "warning").length).toBeGreaterThanOrEqual(2);
  });

  it("aynı başlık + adres mevcutsa politikaya göre atlar / günceller", () => {
    const ex: ExistingProperty = { id: "p1", title: "Moda 3+1", address_line: "Caferağa Mah.", list_price: 1000, features: { rooms: "3+1" } };
    const map = new Map([[propertyKey(ex.title, ex.address_line), ex]]);
    const row = { row: 2, title: "MODA 3+1", address_line: "caferaga mah.", list_price: "2.000.000" };
    expect(planPropertyRows([row], map, "skip")[0].status).toBe("skip");
    const up = planPropertyRows([row], map, "update")[0];
    expect(up.status).toBe("update");
    expect(up.patch).toEqual({ list_price: 2000000 });
    expect(up.prev).toEqual({ list_price: 1000 });
    expect(planPropertyRows([row], map, "create")[0].status).toBe("new");
  });
});

describe("talep", () => {
  const lookup = buildCustomerLookup([existingAyse]);

  it("müşteri telefonu/e-postası zorunlu ve geçerli olmalı", () => {
    expect(validateDemandRow({ row: 2 }).issues[0].level).toBe("error");
    expect(validateDemandRow({ row: 2, customer_phone: "xyz" }).data).toBeUndefined();
  });

  it("müşteriyle eşler, bulunamazsa hata verir, aynı kriterli aktif talebi atlar", () => {
    const rows = [
      { row: 2, customer_phone: "0532 123 45 67", transaction_type: "Satılık", budget_max: "4.500.000", rooms: "3+1" },
      { row: 3, customer_phone: "0599 999 99 99", transaction_type: "Satılık" },
    ];
    const planned = planDemandRows(rows, lookup, new Set(), "skip");
    expect(planned.map((p) => p.status)).toEqual(["new", "error"]);
    expect(planned[0].data?.columns.budget_max).toBe(4500000);
    expect(planned[1].issues.at(-1)?.message).toMatch(/müşteri bulunamadı/i);

    const key = planDemandRows([rows[0]], lookup, new Set(), "skip");
    expect(key[0].status).toBe("new");
    // aynı satır dosyada ikinci kez → atlanır
    const dup = planDemandRows([rows[0], { ...rows[0], row: 9 }], lookup, new Set(), "skip");
    expect(dup.map((p) => p.status)).toEqual(["new", "skip"]);
  });
});

describe("yardımcılar", () => {
  it("parseTurkishNumber TR yazımlarını çözer", () => {
    expect(parseTurkishNumber("1.250.000,50")).toBe(1250000.5);
    expect(parseTurkishNumber("4.500.000")).toBe(4500000);
    expect(parseTurkishNumber("125")).toBe(125);
    expect(parseTurkishNumber("abc")).toBeNull();
  });

  it("buildIssueCsv orijinal kolonlarla hatalı satırları üretir", () => {
    const csv = buildIssueCsv(
      ["Ad", "Tel"],
      [
        ["Ali", "123"],
        ["Veli", "05321234567"],
      ],
      [
        { row: 2, status: "error", issues: [{ level: "error", message: 'Telefon "123" geçersiz' }] },
        { row: 3, status: "new", issues: [] },
      ],
    );
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Satır;Durum;Sebep;Ad;Tel");
    expect(lines[1]).toBe('2;Hatalı;"Telefon ""123"" geçersiz";Ali;123');
  });
});
