import { describe, expect, it } from "vitest";
import { PORTAL_FEATURES, featureFormValue, parsePortalFeatureFields } from "./features";
import { buildPortalPayload, normalizeRooms, readinessCheck, type PortalPropertyInput } from "./payload";
import { chooseOption, parseNumericOption, planFill, mergeApplyResults, summarizeReport, type ControlDescriptor } from "./fill-plan";
import { fold, propertyKind, FIELD_RULES, FILL_FIELD_KEYS, PORTAL_FORM_RULES } from "./rules";
import { codeOutcomeMessage, generateTransferCode, hashTransferCode, normalizeTransferCode } from "./code";
import { buildDraft, importSummaryText, inferPropertyType, inferTransaction, planImport, sanitizeImportItems, summarizeImport } from "./import-plan";
import type { PropertyForMatch } from "@/lib/listing-control/inventory-import";

const form = (o: Record<string, string>) => ({ has: (n: string) => n in o, get: (n: string) => o[n] });

describe("portal alanları (features jsonb)", () => {
  it("yalnız formda BULUNAN alanları yazar; boş alan anahtarı temizler (null)", () => {
    const r = parsePortalFeatureFields(form({ gross_sqm: "120", bathrooms: "", balcony: "yes", in_site: "no" }));
    expect(r).toEqual({ gross_sqm: 120, bathrooms: null, balcony: true, in_site: false });
    expect(Object.keys(parsePortalFeatureFields(form({})))).toEqual([]);
  });
  it("Türkçe ve düz sayı biçimlerini okur; geçersiz değer sessizce boş olur", () => {
    expect(parsePortalFeatureFields(form({ dues: "1.250,50" })).dues).toBe(1250.5);
    expect(parsePortalFeatureFields(form({ dues: "1250.5" })).dues).toBe(1250.5);
    expect(parsePortalFeatureFields(form({ net_sqm: "-5", total_floors: "999", furnished: "Belki", currency: "TL" }))).toEqual({
      net_sqm: null,
      total_floors: null,
      furnished: null,
      currency: "TL",
    });
  });
  it("her alanın form varsayılanı üretilir", () => {
    const f = { balcony: false, site_name: "Moda Konakları", dues: 900 };
    const byKey = (k: string) => PORTAL_FEATURES.find((d) => d.key === k)!;
    expect(featureFormValue(byKey("balcony"), f)).toBe("no");
    expect(featureFormValue(byKey("site_name"), f)).toBe("Moda Konakları");
    expect(featureFormValue(byKey("elevator"), f)).toBe("");
  });
  it("form bileşeni her portal alanını LİTERAL name olarak içerir (form-tabs sözleşmesi bunu okur)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/app/portal-feature-fields.tsx", "utf8");
    for (const d of PORTAL_FEATURES) expect(src, d.key).toContain(`name="${d.key}"`);
  });
});

const base: PortalPropertyInput = {
  id: "p1",
  propertyCode: "ES-2610-AB12CD",
  title: "Kadıköy Moda 3+1",
  transactionType: "Satılık",
  propertyType: "Daire",
  listPrice: 6_750_000,
  provinceName: "İstanbul",
  districtName: "Kadıköy",
  neighborhoodName: "Moda",
  addressLine: null,
  features: { rooms: "3 + 1", sqm: 120, net_sqm: 105, floor: 3, total_floors: 8, heating: "Kombi (Doğalgaz)", building_age: 5, bathrooms: 2, description: "<p>Güzel daire</p>", balcony: true, in_site: false },
  parcelBlock: "1234",
  parcelLot: "56",
  swapOk: false,
  eidsPropertyNo: "ABC-123456",
  authorityDocNo: "YB-1",
  authorityEidsStatus: "approved",
  authorizationStart: "2026-01-01",
  authorizationEnd: "2027-06-01",
  deedStatus: "kat_mulkiyeti",
  photos: [
    { id: "m2", fileName: "b.jpg", fileType: "image/jpeg", isCover: false, sortOrder: 2 },
    { id: "m1", fileName: "a.jpg", fileType: "image/jpeg", isCover: false, sortOrder: 1 },
    { id: "m3", fileName: "kapak.jpg", fileType: "image/jpeg", isCover: true, sortOrder: 9 },
    { id: "d1", fileName: "tapu.pdf", fileType: "application/pdf", isCover: false, sortOrder: 0 },
  ],
};
const NOW = Date.parse("2026-10-12T10:00:00Z");

describe("alan eşleme: aktarım paketi", () => {
  it("özellikleri portal alanlarına eşler; brüt m² yoksa m² (brüt) kabul edilir; açıklama düz metin olur", () => {
    const p = buildPortalPayload(base, "sahibinden", NOW);
    expect(p.fields).toMatchObject({
      title: "Kadıköy Moda 3+1",
      price: 6_750_000,
      currency: "TL",
      gross_sqm: 120,
      net_sqm: 105,
      rooms: "3+1",
      floor: 3,
      total_floors: 8,
      building_age: 5,
      bathrooms: 2,
      balcony: true,
      in_site: false,
      swap: false,
      deed_status: "Kat mülkiyeti",
      eids_property_no: "ABC-123456",
      description: "Güzel daire",
    });
    expect(p.fields.parcel_block).toBeUndefined(); // konut: ada/parsel gitmez
  });
  it("fotoğraflar: yalnız görsel, kapak önce, sıra korunur, portal sınırında kesilir", () => {
    const p = buildPortalPayload(base, "sahibinden", NOW);
    expect(p.photos.map((x) => x.id)).toEqual(["m3", "m1", "m2"]);
    const many = { ...base, photos: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, fileName: null, fileType: "image/png", isCover: i === 7, sortOrder: i })) };
    const q = buildPortalPayload(many, "emlakjet", NOW);
    expect(q.photos).toHaveLength(PORTAL_FORM_RULES.emlakjet.maxPhotos);
    expect(q.photos[0]!.id).toBe("f7");
    expect(q.photosTrimmed).toBe(10);
  });
  it("arsa türünde ada/parsel gönderilir", () => {
    const p = buildPortalPayload({ ...base, propertyType: "Arsa" }, "hepsiemlak", NOW);
    expect(p.kind).toBe("land");
    expect(p.fields).toMatchObject({ parcel_block: "1234", parcel_lot: "56" });
  });
  it("hazırlık kontrolü: eksikleri ve EİDS uyarısını söyler, ENGELLEMEZ", () => {
    const sparse = buildPortalPayload({ ...base, eidsPropertyNo: null, features: { sqm: 90 }, authorityEidsStatus: "pending", photos: [], deedStatus: null }, "sahibinden", NOW);
    const r = readinessCheck(sparse);
    const keys = r.missing.map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["description", "eids_property_no", "photos", "rooms", "bathrooms", "deed_status"]));
    expect(r.missing.find((m) => m.key === "eids_property_no")!.level).toBe("required");
    expect(r.missing.find((m) => m.key === "bathrooms")!.level).toBe("recommended");
    expect(r.warnings.join(" ")).toMatch(/EİDS taşınmaz numarası girilmemiş/);
    expect(r.warnings.join(" ")).toMatch(/onayı henüz alınmadı/);
    expect(r.ready).toBe(false);
    expect(readinessCheck(buildPortalPayload(base, "sahibinden", NOW)).ready).toBe(true);
  });
  it("normalizeRooms ve fold", () => {
    expect(normalizeRooms("3 + 1")).toBe("3+1");
    expect(normalizeRooms("Stüdyo")).toBe("Stüdyo");
    expect(fold("Isıtma (Kombi/Doğalgaz) İSTANBUL")).toBe("isitma kombi dogalgaz istanbul");
    expect(propertyKind("Müstakil ev")).toBe("residential");
    expect(propertyKind("Dükkan")).toBe("commercial");
  });
  it("kural tablosu: her doldurulabilir alan için bir kural vardır", () => {
    expect(FIELD_RULES.map((r) => r.key).sort()).toEqual([...FILL_FIELD_KEYS].sort());
  });
});

describe("seçenek seçimi", () => {
  it("bina yaşı aralıklarına yerleştirir", () => {
    const opts = ["Seçiniz", "0 (Yeni)", "1", "2", "3", "4", "5-10", "11-15", "16-20", "21 ve üzeri"];
    expect(chooseOption("building_age", 0, opts)).toBe(1);
    expect(chooseOption("building_age", 3, opts)).toBe(4);
    expect(chooseOption("building_age", 7, opts)).toBe(6);
    expect(chooseOption("building_age", 30, opts)).toBe(9);
    expect(parseNumericOption("21-25")).toEqual({ min: 21, max: 25 });
    expect(parseNumericOption("21 ve üzeri")?.max).toBe(Infinity);
  });
  it("kat: giriş/bodrum sözcükleri ve sayılar", () => {
    const opts = ["Seçiniz", "Bodrum", "Giriş", "1", "2", "3", "10 ve üzeri"];
    expect(chooseOption("floor", 0, opts)).toBe(2);
    expect(chooseOption("floor", -1, opts)).toBe(1);
    expect(chooseOption("floor", 3, opts)).toBe(5);
    expect(chooseOption("floor", 12, opts)).toBe(6);
  });
  it("evet/hayır, ısıtma ve oda", () => {
    expect(chooseOption("balcony", true, ["Seçiniz", "Var", "Yok"])).toBe(1);
    expect(chooseOption("balcony", false, ["Seçiniz", "Var", "Yok"])).toBe(2);
    expect(chooseOption("credit_eligible", true, ["Evet", "Hayır"])).toBe(0);
    expect(chooseOption("heating", "Kombi (Doğalgaz)", ["Seçiniz", "Soba", "Kombi Doğalgaz", "Merkezi"])).toBe(2);
    expect(chooseOption("rooms", "3+1", ["Seçiniz", "2+1", "3+1", "3+2"])).toBe(2);
    expect(chooseOption("heating", "Yerden ısıtma", ["Seçiniz", "Soba", "Merkezi"])).toBeNull();
    expect(chooseOption("heating", "Soba", ["Seçiniz"])).toBeNull();
  });
});

function d(p: Partial<ControlDescriptor> & { idx: number; labels: string[] }): ControlDescriptor {
  return { tag: "input", type: "text", options: [], current: "", checked: false, group: "", optionText: "", disabled: false, visible: true, ...p };
}

describe("doldurma planı", () => {
  const payload = buildPortalPayload(base, "sahibinden", NOW);
  it("etiketle eşler; brüt/net karışmaz; ad/kimlikten (camelCase) de bulur", () => {
    const plan = planFill(
      [
        d({ idx: 0, labels: ["İlan Başlığı"] }),
        d({ idx: 1, labels: ["m² (Brüt)"] }),
        d({ idx: 2, labels: ["m² (Net)"] }),
        d({ idx: 3, labels: ["fiyatInput"], type: "number" }),
        d({ idx: 4, tag: "textarea", type: "", labels: ["Açıklama"] }),
        d({ idx: 5, labels: ["internet"] }),
      ],
      payload,
    );
    const text = Object.fromEntries(plan.actions.filter((a) => a.op === "text").map((a) => [a.idx, (a as { value: string }).value]));
    expect(text[0]).toBe("Kadıköy Moda 3+1");
    expect(text[1]).toBe("120");
    expect(text[2]).toBe("105");
    expect(text[4]).toBe("Güzel daire");
    expect(text[5]).toBeUndefined(); // "internet" ≠ "net"
  });
  it("select, onay kutusu ve radyo grubu", () => {
    const plan = planFill(
      [
        d({ idx: 0, tag: "select", type: "", labels: ["Isıtma"], options: ["Seçiniz", "Soba", "Kombi Doğalgaz"], current: "Seçiniz" }),
        d({ idx: 1, tag: "select", type: "", labels: ["Bina Yaşı"], options: ["Seçiniz", "0", "5-10"], current: "Seçiniz" }),
        d({ idx: 2, type: "checkbox", labels: ["Balkon"], checked: false }),
        d({ idx: 3, type: "radio", labels: ["Site İçerisinde"], group: "site", optionText: "Evet" }),
        d({ idx: 4, type: "radio", labels: ["Site İçerisinde"], group: "site", optionText: "Hayır" }),
      ],
      payload,
    );
    expect(plan.actions).toContainEqual({ idx: 0, op: "select", field: "heating", optionIndex: 2 });
    expect(plan.actions).toContainEqual({ idx: 1, op: "select", field: "building_age", optionIndex: 2 });
    expect(plan.actions).toContainEqual({ idx: 2, op: "click", field: "balcony" });
    expect(plan.actions).toContainEqual({ idx: 4, op: "click", field: "in_site" }); // in_site=false → "Hayır"
  });
  it("dolu alana dokunmaz; seçeneği olmayan ve bulunamayan alanı ELLE listesine koyar", () => {
    const plan = planFill(
      [
        d({ idx: 0, labels: ["İlan Başlığı"], current: "Elle yazdım" }),
        d({ idx: 1, tag: "select", type: "", labels: ["Isıtma"], options: ["Seçiniz", "Soba"], current: "Seçiniz" }),
      ],
      payload,
    );
    expect(plan.actions).toHaveLength(0);
    expect(plan.report.find((r) => r.key === "title")!.status).toBe("already_filled");
    expect(plan.report.find((r) => r.key === "heating")!.status).toBe("no_option");
    expect(plan.report.find((r) => r.key === "bathrooms")!.status).toBe("not_found");
    expect(plan.manual.join("|")).toMatch(/Isıtma: Kombi \(Doğalgaz\)/);
    expect(plan.manual.join("|")).toMatch(/Banyo sayısı: 2/);
  });
  it("telefon, e-posta, parola ve dosya denetimlerine ASLA dokunmaz", () => {
    const plan = planFill(
      [
        d({ idx: 0, type: "tel", labels: ["İlan Başlığı", "Telefon"] }),
        d({ idx: 1, type: "password", labels: ["Fiyat"] }),
        d({ idx: 2, type: "email", labels: ["Açıklama"] }),
        d({ idx: 3, type: "file", labels: ["Fotoğraf"] }),
        d({ idx: 4, labels: ["Gizli başlık"], visible: false }),
        d({ idx: 5, labels: ["İlan Başlığı"], disabled: true }),
      ],
      payload,
    );
    expect(plan.actions).toHaveLength(0);
  });
  it("uygulama sonucu başarısızsa alan 'bulunamadı' sayılır; özet sayıları doğrudur", () => {
    const plan = planFill([d({ idx: 0, labels: ["İlan Başlığı"] }), d({ idx: 1, labels: ["Fiyat"], type: "number" })], payload);
    const merged = mergeApplyResults(plan, [
      { idx: 0, ok: true },
      { idx: 1, ok: false },
    ]);
    expect(merged.find((r) => r.key === "price")!.status).toBe("not_found");
    expect(merged.find((r) => r.key === "title")!.status).toBe("planned");
    const s = summarizeReport(merged);
    expect(s.filled).toBe(1);
    expect(s.manual).toBeGreaterThan(1);
  });
});

describe("aktarım kodu", () => {
  it("biçim, alfabe ve normalleştirme", () => {
    const c = generateTransferCode();
    expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    expect(normalizeTransferCode(c.toLowerCase().replace("-", " "))).toBe(c);
    expect(normalizeTransferCode("ABC")).toBeNull();
    expect(normalizeTransferCode("OOOOO-IIIII")).toBeNull();
    expect(normalizeTransferCode(42)).toBeNull();
  });
  it("özet 64 hex ve kararlı; iki kod aynı özeti vermez", () => {
    const a = generateTransferCode();
    expect(hashTransferCode(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTransferCode(a)).toBe(hashTransferCode(a));
    expect(new Set(Array.from({ length: 50 }, () => generateTransferCode())).size).toBe(50);
  });
  it("RPC sonuçları Türkçe iletiye çevrilir", () => {
    expect(codeOutcomeMessage("used")).toMatch(/daha önce kullanıldı/);
    expect(codeOutcomeMessage("expired")).toMatch(/süresi doldu/);
    expect(codeOutcomeMessage("invalid")).toMatch(/bulunamadı/);
  });
});

describe("içe aktarma planı", () => {
  const sah = (id: string, extra: Record<string, unknown> = {}) => ({ externalId: id, url: `https://www.sahibinden.com/ilan/emlak-konut-satilik-kadikoy-moda-${id}/detay`, ...extra });
  it("ilan no/URL doğrulanır, tekrarlar ve geçersizler atılır", () => {
    const items = sanitizeImportItems("sahibinden", [sah("1234567890", { title: "3+1 Kadıköy", price: 5_000_000 }), sah("1234567890"), { externalId: "abc" }, { url: "https://evil.example/ilan/1234567891" }, null]);
    expect(items.map((i) => i.externalId)).toEqual(["1234567890"]);
    expect(items[0]).toMatchObject({ title: "3+1 Kadıköy", price: 5_000_000 });
  });
  it("tür ve işlem tahmini; taslak başlığı", () => {
    expect(inferTransaction("Moda'da kiralık 2+1", null)).toBe("Kiralık");
    expect(inferTransaction("Satılık daire", null)).toBe("Satılık");
    expect(inferPropertyType("Satılık müstakil ev", null)).toBe("Müstakil ev");
    expect(inferPropertyType("Satılık arsa", null)).toBe("Arsa");
    expect(inferPropertyType("3+1", "https://x/emlak-konut-satilik-villa-1")).toBe("Villa");
    const [item] = sanitizeImportItems("sahibinden", [sah("1234567890")]);
    expect(buildDraft("sahibinden", item!).title).toBe("sahibinden ilanı 1234567890");
  });
  it("önce ilan no (zaten bağlı), sonra eşleştirme motoru (olası eşleşme), kalan yeni taslak; mükerrer taslak YOK", () => {
    const items = sanitizeImportItems("sahibinden", [
      sah("1111111111", { title: "Moda 3+1 satılık", price: 6_000_000, sqm: 120, rooms: "3+1", location: "Kadıköy / İstanbul" }),
      sah("2222222222", { title: "Moda 3+1 satılık daire", price: 6_000_000, sqm: 120, rooms: "3+1", location: "Kadıköy / İstanbul" }),
      sah("3333333333", { title: "Beşiktaş 1+1", price: 2_000_000, sqm: 55, rooms: "1+1", location: "Beşiktaş / İstanbul" }),
    ]);
    const pool: PropertyForMatch[] = [
      { id: "prop-A", code: "ES-A", title: "Moda 3+1 satılık daire", address: "Kadıköy / İstanbul", price: 6_000_000, sqm: 120, rooms: "3+1", block: null, lot: null, lat: null, lng: null, districtKey: null, advisorName: null },
    ];
    const bound = new Map([["1111111111", { propertyId: "prop-X", propertyCode: "ES-X" }]]);
    const out = planImport("sahibinden", items, bound, pool);
    const kind = (id: string) => out.find((o) => o.item.externalId === id)!.kind;
    expect(kind("1111111111")).toBe("already_bound");
    expect(kind("2222222222")).toBe("possible_match");
    expect(kind("3333333333")).toBe("new");
    const pm = out.find((o) => o.kind === "possible_match")!;
    expect(pm.kind === "possible_match" && pm.propertyId).toBe("prop-A");
    const sum = summarizeImport(out.map((o) => ({ kind: o.kind === "new" ? ("created" as const) : o.kind })));
    expect(sum).toEqual({ created: 1, alreadyBound: 1, possibleMatch: 1, failed: 0, total: 3 });
    expect(importSummaryText(sum)).toBe("1 taslak portföy eklendi · 1 olası eşleşme kuyruğa alındı · 1 zaten bağlıydı.");
  });
  it("aynı ilan no kiracı dışına sızmaz: eşleme yalnız çağıranın verdiği bağlı haritasına bakar", () => {
    const items = sanitizeImportItems("sahibinden", [sah("4444444444")]);
    const other = new Map([["4444444444", { propertyId: "baska-ofis", propertyCode: null }]]);
    expect(planImport("sahibinden", items, new Map(), [])[0]!.kind).toBe("new");
    expect(planImport("sahibinden", items, other, [])[0]!.kind).toBe("already_bound"); // harita çağıran tarafından RLS'li sorguyla kurulur
  });
});
