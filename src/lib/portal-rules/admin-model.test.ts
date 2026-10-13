import { describe, expect, it } from "vitest";
import {
  changeSummaryLines,
  confidenceBucket,
  fieldLabel,
  formChangedText,
  formatConfidence,
  needsPiiAck,
  normalizeOverview,
  parsePortal,
  parseView,
  portalRulesHref,
  sourceBadge,
  suggestedExclusion,
  toFormAlert,
  withVersion,
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
    expect(portalRulesHref("hepsiemlak", "alan:heating")).toBe("/admin/sistem?sekme=portal-kurallari&portal=hepsiemlak&gorunum=alan%3Aheating");
    expect(portalRulesHref("sahibinden")).toBe("/admin/sistem?sekme=portal-kurallari&portal=sahibinden");
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
      "sahibinden.com ilan formu değişti: yeni yapı 2 ofiste görüldü (40 alan · önceki yapıyla benzerlik %62). Eşleşmeyen alanları kontrol edin.",
    );
    expect(formChangedText("emlakjet", { alertState: "info", tenantsN: 1, fieldCount: 12, jaccardPrev: null })).toMatch(/olası değişiklik/);
  });
});

describe("normalizeOverview", () => {
  it("alan sayıları okunur; bilinmeyen biçim boş", () => {
    const o = normalizeOverview({ fields: [{ field_key: "heating", support_tenants: 3, contradict_tenants: 1, success_14d: 0.8, attempts_14d: 10, last_seen: "2026-10-12T00:00:00Z" }], pending_proposals: 2 });
    expect(o.fields.get("heating")).toMatchObject({ supportTenants: 3, contradictTenants: 1, success14d: 0.8, attempts14d: 10 });
    expect(o.pendingProposals).toBe(2);
    expect(normalizeOverview("x").fields.size).toBe(0);
    expect(normalizeOverview([{ key: "price", ok_14d: 3, attempts_14d: 4 }]).fields.get("price")?.success14d).toBe(0.75);
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

describe("withVersion", () => {
  it("tabanı değiştirmeden sürüm ve yayın anı yazar", () => {
    const base = { version: 0, issuedAt: "x", fields: [] };
    expect(withVersion(base, 4, "2026-10-13T00:00:00.000Z")).toEqual({ version: 4, issuedAt: "2026-10-13T00:00:00.000Z", fields: [] });
    expect(base.version).toBe(0);
  });
});
