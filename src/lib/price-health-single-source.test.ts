import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computePriceHealth, normalizePriceHealth, resolveShownPriceHealth } from "@/lib/price-health";
import { priceHealthLabel } from "@/lib/property-labels";
import { priceHealthPill } from "@/app/app/portfoyler/property-list-logic";
import { diagnoseSaleBlockers } from "@/lib/sale-diagnostics";

/**
 * YD5: bir portföy sayfasında TEK fiyat sağlığı mesajı. Canlıda DEMO-001'de künye "Fiyat uygun" (saklanan kolon) derken
 * satış teşhisi anlık m² modelinden "Fiyat emsalin belirgin üzerinde (~%43)" diyordu.
 */

const diagBase = {
  status: "live",
  daysOnMarket: 10,
  totalViews: 100,
  views7d: 20,
  livePortals: 2,
  mediaCount: 10,
  transactionType: "sale",
};

/** Sayfadaki üç gösterimin (rozet, değerleme kutusu, teşhis) metinleri. */
function shownMessages(stored: string | null, listPrice: number, sqm: number, hint: string) {
  const signal = resolveShownPriceHealth(stored, computePriceHealth({ listPrice, sqm, districtHint: hint, transactionType: "sale" }));
  const diagnosis = diagnoseSaleBlockers({ ...diagBase, priceHealth: signal.health, priceDeltaPct: signal.deltaPct });
  const priceBlockers = diagnosis.blockers.filter((b) => b.key.startsWith("price_"));
  const pricePositives = diagnosis.positives.filter((p) => p.startsWith("Fiyat"));
  return { signal, badge: priceHealthLabel(signal.health), priceBlockers, pricePositives };
}

describe("portföy fiyat sağlığı tek kaynak", () => {
  it("saklanan 'green' + model %43 üstü: rozet, kutu ve teşhis aynı 'Uygun' bandında; çelişen sapma yok", () => {
    // Bodrum 120.000 TL/m² x 100 m² = 12 Mn; liste 17,2 Mn → model ~%43 üstü (kırmızı).
    const reference = computePriceHealth({ listPrice: 17_200_000, sqm: 100, districtHint: "Bodrum", transactionType: "sale" });
    expect(reference.health).toBe("red");
    expect(reference.deltaPct).toBeGreaterThan(40);

    const m = shownMessages("green", 17_200_000, 100, "Bodrum");
    expect(m.signal.health).toBe("green");
    expect(m.signal.deltaPct).toBeNull();
    expect(m.badge).toBe("Uygun");
    expect(m.priceBlockers).toHaveLength(0);
    expect(m.pricePositives).toHaveLength(1);
    expect(m.signal.note).not.toMatch(/%\d/);
  });

  it("saklanan ve model aynı bantta: sapma yüzdesi gösterilir ve teşhis aynı bandı söyler", () => {
    const m = shownMessages("Kırmızı", 17_200_000, 100, "Bodrum");
    expect(m.signal.health).toBe("red");
    expect(m.signal.deltaPct).toBeGreaterThan(40);
    expect(m.badge).toBe("Riskli");
    expect(m.priceBlockers.map((b) => b.key)).toEqual(["price_red"]);
    expect(m.pricePositives).toHaveLength(0);
  });

  it("saklanan değer yoksa sayfa renk uydurmaz (liste 'Bekliyor' der, detay da)", () => {
    const m = shownMessages(null, 17_200_000, 100, "Bodrum");
    expect(m.signal.health).toBe("pending");
    expect(m.badge).toBe("Bekliyor");
    expect(m.priceBlockers).toHaveLength(0);
    expect(m.pricePositives).toHaveLength(0);
    expect(priceHealthPill(null)).toBeNull();
  });

  it("liste kapsülü ve detay rozeti aynı etiket ölçeğini kullanır", () => {
    for (const raw of ["green", "Yeşil", "yellow", "Sarı", "red", "Kırmızı"]) {
      expect(priceHealthPill(raw)?.label).toBe(priceHealthLabel(normalizePriceHealth(raw)));
    }
  });

  it("portföy sayfası saklanan kolonu yalnız resolveShownPriceHealth üzerinden okur", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/app/portfoyler/[id]/page.tsx"), "utf8");
    const uses = src.match(/property\.price_health/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(src).toMatch(/resolveShownPriceHealth\(\s*property\.price_health/);
    expect(src).not.toMatch(/"Yeşil" : priceSignal/);
  });
});
