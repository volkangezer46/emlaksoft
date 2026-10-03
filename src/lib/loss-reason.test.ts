import { describe, expect, it } from "vitest";
import { DEFAULT_DEFINITIONS, SYSTEM_DEFINITION_VALUES } from "@/lib/definition-defaults";
import { DEFINITION_USAGE_REFS } from "@/lib/definition-usage";
import {
  formatLossReason,
  lossReasonGroupLabel,
  lossReasonLabels,
  parseLossReason,
  validateLossReason,
} from "@/lib/loss-reason";

const options = DEFAULT_DEFINITIONS.loss_reason.map((d) => ({ ...d }));
const labels = lossReasonLabels(options);

describe("kayıp nedeni", () => {
  it("seçim zorunlu ve listede olmalı", () => {
    expect(validateLossReason("", "", options).ok).toBe(false);
    expect(validateLossReason("yok_boyle", "", options).ok).toBe(false);
    expect(validateLossReason("fiyat_yuksek", "", options)).toEqual({ ok: true, stored: "fiyat_yuksek" });
  });

  it("'diger' için not zorunlu, diğerlerinde isteğe bağlı", () => {
    expect(validateLossReason("diger", "  ", options).ok).toBe(false);
    expect(validateLossReason("diger", "kardeşi aldı", options)).toEqual({ ok: true, stored: "diger | kardeşi aldı" });
    expect(validateLossReason("vazgecti", "aile kararı", options)).toEqual({ ok: true, stored: "vazgecti | aile kararı" });
  });

  it("not uzunluk sınırı", () => {
    expect(validateLossReason("diger", "x".repeat(301), options).ok).toBe(false);
  });

  it("eski serbest metin olduğu gibi görünür ve kendi adıyla gruplanır", () => {
    expect(parseLossReason("Rakip kapattı", labels)).toMatchObject({ legacy: true, label: "Rakip kapattı", value: null });
    expect(lossReasonGroupLabel("Rakip kapattı", labels)).toBe("Rakip kapattı");
    expect(lossReasonGroupLabel(null, labels)).toBe("Belirtilmemiş");
  });

  it("değer ve notlu değer aynı etiket grubuna düşer; ad değişimi izlenir", () => {
    expect(lossReasonGroupLabel("fiyat_yuksek", labels)).toBe("Fiyat yüksek bulundu");
    expect(lossReasonGroupLabel("fiyat_yuksek | pazarlık", labels)).toBe("Fiyat yüksek bulundu");
    const renamed = lossReasonLabels([{ value: "fiyat_yuksek", label: "Bütçe aşıldı" }]);
    expect(lossReasonGroupLabel("fiyat_yuksek | x", renamed)).toBe("Bütçe aşıldı");
    expect(formatLossReason("diger | kardeşi aldı", labels)).toBe("Diğer — kardeşi aldı");
  });

  it("tanım altyapısı: 'diger' kilitli, kullanım sayımı deals.loss_reason", () => {
    expect(SYSTEM_DEFINITION_VALUES.loss_reason).toContain("diger");
    expect(DEFINITION_USAGE_REFS.loss_reason[0]).toMatchObject({ table: "deals", column: "loss_reason" });
  });
});
