import { describe, expect, it } from "vitest";
import { MEASURE_GZIP_BUDGET, bundleMeasureClient } from "../../../../scripts/build-measure-client";

/**
 * Boyut sözleşmesi: ölçüm istemcisi (web-vitals@4 dahil, tek dosya) gzip ≤ 3 KB. Paket derleme betiğinin kendisiyle
 * bellekte üretilir (yayınlanan dosyayla aynı ayarlar). Gömülü HTML'e eklenen tek şey <script src> etiketidir.
 */
describe("ölçüm istemcisi paketi", () => {
  it("gzip ≤ 3 KB, web-vitals aynı dosyada, CDN/üçüncü taraf adresi yok", async () => {
    const b = await bundleMeasureClient();
    expect(b.gzip).toBeLessThanOrEqual(MEASURE_GZIP_BUDGET);
    expect(MEASURE_GZIP_BUDGET).toBe(3072);
    expect(b.code).toContain("/api/v");
    expect(b.code).toContain("sendBeacon");
    // web-vitals gömülü: dış betik yüklemesi ya da üçüncü taraf kökeni yok.
    expect(b.code).not.toMatch(/https?:\/\/(?!emlaksoft)/);
    expect(b.code).not.toMatch(/document\.cookie|localStorage/);
    expect(b.hash).toMatch(/^[0-9a-f]{10}$/);
  }, 30_000);
});
