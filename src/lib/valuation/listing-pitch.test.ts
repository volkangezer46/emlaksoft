import { describe, expect, it } from "vitest";
import {
  buildPitchCards,
  marketingPlanLines,
  presentationEntry,
  readPresentationEntry,
  sanitizePresentationOptions,
  DEFAULT_PRESENTATION_OPTIONS,
} from "./listing-pitch";

const deal = (sale: number, list: number, days: number) => ({ salePrice: sale, listPrice: list, daysOnMarket: days });

describe("buildPitchCards", () => {
  it("eşik altı (n<3) kart çizilmez, rakam uydurulmaz", () => {
    expect(buildPitchCards({ areaLabel: "Kadıköy", deals: [deal(1, 1, 10), deal(1, 1, 20)], openBuyerDemands: 2 })).toEqual([]);
  });

  it("satış sayısı, medyan gün, satış/ilan oranı ve alıcı talebi", () => {
    const cards = buildPitchCards({
      areaLabel: "Kadıköy",
      deals: [deal(9_500_000, 10_000_000, 30), deal(4_800_000, 5_000_000, 50), deal(2_000_000, 2_000_000, 40)],
      openBuyerDemands: 12,
    });
    expect(cards.map((c) => c.key)).toEqual(["sold", "days", "ratio", "buyers"]);
    expect(cards[1]!.value).toBe("40 gün");
    expect(cards[2]!.value).toBe("%96");
    expect(cards[0]!.note).toContain("Kadıköy");
  });

  it("uçuk oran ve gün değerleri dışarıda kalır", () => {
    const cards = buildPitchCards({
      areaLabel: null,
      deals: [deal(1, 10, -5), deal(100, 10, 99999), deal(5, 10, 10)],
      openBuyerDemands: 0,
    });
    expect(cards.map((c) => c.key)).toEqual(["sold"]);
  });
});

describe("sunum kaydı", () => {
  it("seçenekler beyaz listeden geçer; kayıt okunur", () => {
    const opts = sanitizePresentationOptions({ enabled: true, marketingItems: ["portals", "kotu", "portals"], cta: "evet" });
    expect(opts.marketingItems).toEqual(["portals"]);
    expect(opts.cta).toBe(true);
    const entry = presentationEntry({ options: opts, cards: [], portals: ["Sahibinden"], areaLabel: "Kadıköy", computedAt: "2026-10-15" });
    const read = readPresentationEntry([{ name: "x", weight: 1 }, entry]);
    expect(read?.options.enabled).toBe(true);
    expect(marketingPlanLines(read!)[0]!.detail).toContain("Sahibinden");
    expect(readPresentationEntry([])).toBeNull();
    expect(DEFAULT_PRESENTATION_OPTIONS.enabled).toBe(false);
  });
});
