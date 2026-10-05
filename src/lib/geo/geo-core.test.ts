import { describe, expect, it } from "vitest";
import { editDistance, geoKey, geoSlug } from "./normalize";
import { pickMatch } from "./match";
import { validateChain, type GeoLookup } from "./validate";
import { buildImportPlan, parseImport, validateImportRows, type ExistingGeo, type ImportRow } from "./import-plan";

describe("normalize", () => {
  it("Türkçe I/İ/ı/i ve ASCII slug", () => {
    expect(geoKey("İSTANBUL")).toBe("istanbul");
    expect(geoKey("Iğdır")).toBe("igdir");
    expect(geoKey("ığdır")).toBe("igdir");
    expect(geoSlug("Çankaya Mah.")).toBe("cankaya-mah");
    expect(geoKey("Caferağa Mahallesi", "neighborhood")).toBe("caferaga");
    expect(geoKey("Kadıköy İlçesi", "district")).toBe("kadikoy");
  });
  it("edit distance sınırlıdır", () => {
    expect(editDistance("kadikoy", "kadikoi", 2)).toBe(1);
    expect(editDistance("abc", "xyzxyz", 2)).toBeGreaterThan(2);
  });
});

describe("pickMatch", () => {
  const list = [
    { id: "1", name: "Kadıköy" },
    { id: "2", name: "Kartal" },
    { id: "3", name: "Üsküdar" },
  ];
  it("tam, alias ve yazım toleransı; kısa adda tolerans yok", () => {
    expect(pickMatch("KADIKOY", "district", list)).toEqual({ status: "ok", id: "1", via: "exact" });
    expect(pickMatch("Skudar", "district", list, [{ entityId: "3", alias: "Skudar" }])).toEqual({ status: "ok", id: "3", via: "alias" });
    expect(pickMatch("Kadikoi", "district", list)).toEqual({ status: "ok", id: "1", via: "fuzzy" });
    expect(pickMatch("Kart", "district", list).status).toBe("none");
  });
  it("aynı katmanda birden çok aday belirsizdir", () => {
    const dup = [{ id: "a", name: "Merkez" }, { id: "b", name: "MERKEZ" }];
    expect(pickMatch("merkez", "district", dup).status).toBe("ambiguous");
  });
});

describe("validateChain", () => {
  const lookup: GeoLookup = {
    province: async (id) => (id === "11111111-1111-4111-8111-111111111111" ? { id, name: "A", plateCode: 1, lat: null, lng: null, isActive: true } : null),
    district: async (id) => (id === "22222222-2222-4222-8222-222222222222" ? { id, name: "D", provinceId: "11111111-1111-4111-8111-111111111111", isActive: true } : null),
    neighborhood: async (id) => (id === "33333333-3333-4333-8333-333333333333" ? { id, name: "N", districtId: "22222222-2222-4222-8222-222222222222", isActive: false } : null),
  };
  const P = "11111111-1111-4111-8111-111111111111";
  const D = "22222222-2222-4222-8222-222222222222";
  const N = "33333333-3333-4333-8333-333333333333";
  it("tutarlı zincir geçer, hiyerarşi bozulursa reddedilir", async () => {
    expect(await validateChain(lookup, { province_id: P, district_id: D })).toBeNull();
    expect(await validateChain(lookup, { district_id: D })).toContain("il");
    expect(await validateChain(lookup, { province_id: "x" })).toContain("geçersiz");
  });
  it("pasif kayıt yeni seçimde reddedilir, mevcut kayıtta (allowInactive) geçer", async () => {
    expect(await validateChain(lookup, { province_id: P, district_id: D, neighborhood_id: N })).toContain("kullanılmıyor");
    expect(await validateChain(lookup, { province_id: P, district_id: D, neighborhood_id: N }, { allowInactive: true })).toBeNull();
  });
  it("okuma hatasında güvenli tarafta reddeder", async () => {
    const broken: GeoLookup = { ...lookup, province: async () => { throw new Error("db"); } };
    expect(await validateChain(broken, { province_id: P })).toContain("doğrulanamadı");
  });
});

describe("import planı", () => {
  const provinces = Array.from({ length: 81 }, (_, i) => ({ id: `p${i + 1}`, plate_code: i + 1, name: `İl${i + 1}`, lat: null, lng: null, is_active: true }));
  const existing: ExistingGeo = {
    provinces,
    districts: [
      { id: "d1", province_id: "p34", name: "Kadıköy", source_id: 10, lat: null, lng: null, is_active: true },
      { id: "d2", province_id: "p34", name: "Eski İlçe", source_id: 11, lat: null, lng: null, is_active: true },
    ],
    neighborhoods: [
      { id: "n1", district_id: "d1", name: "Caferağa", source_id: 100, postal_code: null, is_active: true },
      { id: "n2", district_id: "d1", name: "Silinmiş Mah", source_id: 101, postal_code: null, is_active: true },
    ],
  };
  const row = (r: Partial<ImportRow>): ImportRow => ({ plate_code: 34, province: "İl34", district: "", neighborhood: "", source_id: null, postal_code: null, lat: null, lng: null, population: null, line: 1, ...r });

  it("CSV ve JSON ayrıştırılır (başlık eş anlamlıları, noktalı virgül)", () => {
    const csv = parseImport("plaka;il;ilce;mahalle;kaynak_id\n34;İstanbul;Kadıköy;Moda;5");
    expect(csv.rows[0]).toMatchObject({ plate_code: 34, province: "İstanbul", district: "Kadıköy", neighborhood: "Moda", source_id: 5 });
    const json = parseImport(JSON.stringify({ meta: { source: "x" }, rows: [{ plate_code: 1, province: "Adana" }] }));
    expect(json.meta.source).toBe("x");
    expect(json.rows).toHaveLength(1);
    expect(parseImport("{bozuk").errors.length).toBeGreaterThan(0);
  });

  it("doğrulama: plaka aralığı, il-ilçe bağı, 81 il (tam kip)", () => {
    expect(validateImportRows([row({ plate_code: 99 })], { mode: "merge" }).errors.join()).toContain("01-81");
    expect(validateImportRows([row({ plate_code: null, district: "X" })], { mode: "merge" }).errors.length).toBeGreaterThan(0);
    const full = validateImportRows([row({})], { mode: "full" });
    expect(full.errors.join()).toContain("81");
  });

  it("fark: ekle / değiştir / pasife al; pasif kayıt yeniden açılmaz; silme yok", () => {
    const rows = [
      row({ line: 1, district: "Kadıköy", source_id: 10 }), // değişmez
      row({ line: 2, district: "Kadıköy", neighborhood: "Caferağa Mahallesi", source_id: 100 }), // ad değişti
      row({ line: 3, district: "Kadıköy", neighborhood: "Yeni Mah", source_id: 200 }), // eklenecek
      row({ line: 4, district: "Yeni İlçe", source_id: 300 }), // eklenecek
    ];
    const plan = buildImportPlan(rows, existing, { mode: "merge" });
    expect(plan.errors).toEqual([]);
    expect(plan.summary.add).toEqual({ province: 0, district: 1, neighborhood: 1 });
    expect(plan.summary.change.neighborhood).toBe(1);
    expect(plan.summary.deactivate.neighborhood).toBe(0);
    expect(plan.ops.some((o) => o.op === "update" && o.aliasFrom === "Caferağa")).toBe(true);
    expect(plan.ops.every((o) => (o.op as string) !== "delete")).toBe(true);
  });

  it("tam kaynak: dosyada olmayan aktif kayıt pasife alınır (yalnız dosyadaki illerde)", () => {
    const rows = [
      ...provinces.map((p, i) => row({ line: i + 1, plate_code: p.plate_code, province: p.name })),
      row({ line: 200, district: "Kadıköy", source_id: 10 }),
    ];
    const plan = buildImportPlan(rows, existing, { mode: "full" });
    expect(plan.errors).toEqual([]);
    expect(plan.summary.deactivate.district).toBe(1); // "Eski İlçe"
    expect(plan.summary.deactivate.neighborhood).toBe(2); // d1'in iki mahallesi dosyada yok
  });
});
