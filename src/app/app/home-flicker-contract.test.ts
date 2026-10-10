import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ana ekran "2 kez yükleniyor" regresyon sözleşmesi (2026-10 ölçümü):
 *  1. /app loading.tsx gerçek ana ekranla aynı şekli taşır (genel SkeletonDashboard ızgarası DEĞİL) → iskelet→gerçek düzen sıçraması yok.
 *  2. İskelet ızgarası ve onun yerine geçen içerik ızgarası `stagger={false}`: yoksa iskelet belirir, içerik sıfır opaklıktan ikinci kez belirir.
 *  3. Realtime kancası aboneliğin KENDİSİNDE refresh tetiklemez (yalnız gelen değişiklik olayında).
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("ana ekran yanıp sönme sözleşmesi", () => {
  it("/app loading.tsx ana ekran şeklindedir", () => {
    const src = read("src/app/app/loading.tsx");
    expect(src).not.toContain("SkeletonDashboard");
    expect(src).toContain("ds-hero");
  });

  it("DashboardGrid iskelet/içerik takaslarında stagger kapalıdır", () => {
    const src = read("src/app/app/page.tsx");
    expect(src).not.toMatch(/<DashboardGrid(?![^>]*stagger=\{false\})[^>]*>/);
  });

  it("realtime kancası subscribe() içinde refresh çağırmaz", () => {
    const src = read("src/hooks/use-realtime-refresh.ts");
    const subscribeIdx = src.indexOf("ch.subscribe()");
    expect(subscribeIdx).toBeGreaterThan(0);
    const around = src.slice(Math.max(0, subscribeIdx - 40), subscribeIdx + 40);
    expect(around).not.toContain("router.refresh");
  });
});
