import { describe, expect, it } from "vitest";
import {
  changeSummaryLines,
  confidenceBucket,
  fieldLabel,
  formChangedText,
  formatConfidence,
  needsPiiAck,
  fieldOverviewFromProposals,
  parsePortal,
  parseView,
  portalRulesHref,
  sourceBadge,
  suggestedExclusion,
  toFormAlert,
} from "./admin-model";

describe("confidenceBucket", () => {
  it("≥0,5 yüksek, 0,3–0,5 orta, altı düşük", () => {
    expect(confidenceBucket(0.62)).toBe("yuksek");
    expect(confidenceBucket(0.5)).toBe("yuksek");
    expect(confidenceBucket(0.498)).toBe("orta");
    expect(confidenceBucket(0.3)).toBe("orta");
    expect(confidenceBucket(0.29)).toBe("dusuk");
    expect(confidenceBucket(null)).toBe("dusuk");
    expect(confidenceBucket(Number.NaN)).toBe("dusuk");
  });
  it("Türkçe ondalık", () => {
    expect(formatConfidence(0.526)).toBe("0,53");
  });
});

describe("URL filtreleri", () => {
  it("portal ve görünüm ayrıştırılır; bilinmeyen değer varsayılana düşer", () => {
    expect(parsePortal("emlakjet")).toBe("emlakjet");
    expect(parsePortal("zingat")).toBe("sahibinden");
    expect(parseView("oneriler")).toEqual({ kind: "oneriler" });
    expect(parseView("alan:heating")).toEqual({ kind: "alan", key: "heating" });
    expect(parseView("kanit:11111111-1111-4111-8111-111111111111")).toEqual({ kind: "kanit", id: "11111111-1111-4111-8111-111111111111" });
    expect(parseView(`form:${"a".repeat(64)}`)).toEqual({ kind: "form", fingerprint: "a".repeat(64) });
    expect(parseView("kanit:'; drop")).toEqual({ kind: "genel" });
    expect(parseView(undefined)).toEqual({ kind: "genel" });
  });
  it("derin bağlantı sekmeyi, portalı ve görünümü taşır", () => {
    expect(portalRulesHref("hepsiemlak", "alan:heating")).toBe("/admin/sistem?sekme=entegrasyonlar&portal=hepsiemlak&gorunum=alan%3Aheating#portal-kurallari");
    expect(portalRulesHref("sahibinden")).toBe("/admin/sistem?sekme=entegrasyonlar&portal=sahibinden#portal-kurallari");
  });
});

describe("etiketler", () => {
  it("kaynak rozeti", () => {
    expect(sourceBadge("corrections").label).toBe("Düzeltme");
    expect(sourceBadge("unmatched").label).toBe("Eşleşmeyen");
    expect(sourceBadge("ai", true).label).toBe("AI · doğrulanmamış");
    expect(sourceBadge("staff").label).toBe("Personel");
  });
  it("alan adı rules.ts'ten", () => {
    expect(fieldLabel("net_sqm")).toBe("Net m²");
    expect(fieldLabel(null)).toBe("Eşleşmemiş alan");
  });
  it("tek ofisten gelen metin önerisi kişisel veri teyidi ister", () => {
    expect(needsPiiAck("label_map", 1)).toBe(true);
    expect(needsPiiAck("new_field", 0)).toBe(true);
    expect(needsPiiAck("label_map", 2)).toBe(false);
    expect(needsPiiAck("field_demote", 1)).toBe(false);
  });
});

describe("changeSummaryLines", () => {
  it("dizi ve {changes} biçimi okunur farka çevrilir", () => {
    expect(changeSummaryLines([{ kind: "label_map", field_key: "heating", added: ["isinma"] }])).toEqual(["Isıtma: etiket eklendi (isinma)"]);
    expect(changeSummaryLines({ changes: [{ kind: "field_demote", key: "eids_property_no" }] })[0]).toMatch(/geriletildi/);
  });
  it("tohum ve geri alma", () => {
    expect(changeSummaryLines({ seed: true }, { kind: "seed" })[0]).toMatch(/tohum/);
    expect(changeSummaryLines(null, { kind: "rollback", rollsBackTo: 1 })).toEqual(["Sürüm 1 içeriğine geri dönüldü"]);
  });
  it("tanınmayan biçim boş (uydurma yok)", () => {
    expect(changeSummaryLines({ x: 1 })).toEqual([]);
    expect(changeSummaryLines(null)).toEqual([]);
  });
});

describe("form değişti", () => {
  it("yalnız warning/info satırları uyarıdır", () => {
    expect(toFormAlert({ fingerprint: "f", alert_state: "none" })).toBeNull();
    const a = toFormAlert({ fingerprint: "f", alert_state: "warning", field_count: 40, tenants_n: 2, jaccard_prev: "0.62" })!;
    expect(a).toMatchObject({ alertState: "warning", fieldCount: 40, tenantsN: 2, jaccardPrev: 0.62 });
    expect(formChangedText("sahibinden", a)).toBe(
      "Sahibinden ilan formu değişti: yeni yapı 2 ofiste görüldü (40 alan · önceki yapıyla benzerlik %62). Eşleşmeyen alanları kontrol edin.",
    );
    expect(formChangedText("emlakjet", { alertState: "info", tenantsN: 1, fieldCount: 12, jaccardPrev: null })).toMatch(/olası değişiklik/);
  });
});

describe("fieldOverviewFromProposals", () => {
  it("alan başına açık öneri sayısı, en yüksek destek/karşı ve son değerlendirme; alansız öneri sayılmaz", () => {
    const o = fieldOverviewFromProposals([
      { fieldKey: "heating", supportTenants: 3, contradictTenants: 1, lastEvaluated: "2026-10-11T00:00:00Z" },
      { fieldKey: "heating", supportTenants: 2, contradictTenants: 2, lastEvaluated: "2026-10-12T00:00:00Z" },
      { fieldKey: null, supportTenants: 9, contradictTenants: 0, lastEvaluated: null },
    ]);
    expect(o.fields.get("heating")).toEqual({ key: "heating", supportTenants: 3, contradictTenants: 2, openProposals: 2, lastSeen: "2026-10-12T00:00:00Z" });
    expect(o.fields.size).toBe(1);
    expect(fieldOverviewFromProposals([]).fields.size).toBe(0);
  });
});

describe("uygunluk önerisi", () => {
  it("E2E Test Ofis, Demo Emlak Ofisi ve admin dışlanması önerilir", () => {
    expect(suggestedExclusion({ name: "E2E Test Ofis" })).toMatch(/E2E/);
    expect(suggestedExclusion({ name: "Demo Emlak Ofisi" })).toMatch(/Demo/);
    expect(suggestedExclusion({ name: "admin" })).toMatch(/yönetim/);
    expect(suggestedExclusion({ name: "Gezertaşar Emlak" })).toBeNull();
  });
});
