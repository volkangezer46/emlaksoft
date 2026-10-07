import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregateMarketSignals, marketCellsToCsv, marketSignalRowFromView, MARKET_CSV_HEADER } from "./market-signals";

const src = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("Emlakfiyati anonim dışa aktarım", () => {
  const view = (tenant: string, i: number) => ({
    tenant_id: tenant,
    district_id: "d1",
    property_type: "daire",
    transaction_type: "sale",
    published_month: "2026-08-01",
    published_days: 20 + i,
    price_change_count: i % 2,
    price_delta_pct: -i,
    outcome: i % 2 ? "sold" : "open",
    days_to_outcome: i % 2 ? 30 : null,
  });

  it("görünüm satırı çevrilir; bozuk satır atılır", () => {
    expect(marketSignalRowFromView(view("t1", 1))).toMatchObject({ tenantId: "t1", publishedMonth: "2026-08", outcome: "sold" });
    expect(marketSignalRowFromView({ tenant_id: null })).toBeNull();
  });

  it("CSV'de ofis kimliği yok; k ve ofis alt sınırı uygulanır", () => {
    const rows = [0, 1, 2, 3, 4].map((i) => marketSignalRowFromView(view(i < 3 ? "t1" : "t2", i))!);
    expect(aggregateMarketSignals(rows, { minTenants: 3 })).toEqual([]);
    const cells = aggregateMarketSignals(rows, { minTenants: 2 });
    const csv = marketCellsToCsv(cells, () => ({ province: "İstanbul", district: "Kadıköy" }));
    expect(csv.split("\r\n")[0]).toBe(MARKET_CSV_HEADER.join(","));
    expect(csv).toContain("İstanbul,Kadıköy,daire,sale,2026-08,5,");
    expect(csv).not.toContain("t1");
    expect(csv).not.toContain("t2");
  });

  it("uç: süper admin + hız sınırı + yalnız opt-in okuyucusu; opt-in ayarı varsayılan kapalı", () => {
    const route = src("src/app/admin/ef-kontor/piyasa-verisi/route.ts");
    expect(route).toContain('staff.role !== "super_admin"');
    expect(route).toContain("checkRateLimit(");
    expect(route).toContain("buildMarketExport(");
    const reader = src("src/lib/listing-control/market-export.ts");
    expect(reader).toContain("MARKET_DATA_SHARE_KEY");
    expect(reader).toContain(".range(");
    const registry = src("src/lib/settings/registry/tenant.ts");
    expect(registry).toMatch(/key: MARKET_DATA_SHARE_KEY,[\s\S]{0,80}default: false/);
  });
});
