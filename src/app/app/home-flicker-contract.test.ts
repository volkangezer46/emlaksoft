import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ana ekran "2 kez yükleniyor" ve kabuk açılışı regresyon sözleşmesi (2026-10 ölçümleri; HIZ-2 / SK3):
 *  1. Ana ekran `(bugun)` rota grubundadır; kendi iskeleti gerçek ana ekranla aynı şekli taşır. /app/loading.tsx NÖTR'dür
 *     (Bugün iskeleti DEĞİL): önyüklenmemiş kardeş rotaya geçişte "Ana ekran yükleniyor" görünmez (B023). Eski yol yok.
 *  2. İskelet ızgarası ve onun yerine geçen içerik ızgarası `stagger={false}`; liste girişi (stagger) animasyonu yok,
 *     sayfa geçişi ilk açılışta oynamaz (B027).
 *  3. Kabuk (menü, üst çubuk, sekme şeridi) Suspense DIŞINDA çizilir; layout'ta en çok 3 sınır kalır, bildirim zili akışı
 *     aynen (sözleşme b). Ana ekranın ilk ekran blokları TEK sınırda (B021).
 *  4. Realtime kancası aboneliğin KENDİSİNDE refresh tetiklemez (yalnız gelen değişiklik olayında).
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const count = (src: string, re: RegExp) => src.match(re)?.length ?? 0;

describe("ana ekran yanıp sönme sözleşmesi", () => {
  it("ana ekran rota grubunda; iskeleti ana ekran şeklinde, /app iskeleti nötr; eski yol yok", () => {
    expect(existsSync(join(process.cwd(), "src/app/app/page.tsx"))).toBe(false);
    const bugun = read("src/app/app/(bugun)/loading.tsx");
    expect(bugun).not.toContain("SkeletonDashboard");
    expect(bugun).toContain("ds-hero");
    const neutral = read("src/app/app/loading.tsx");
    expect(neutral).not.toContain("ds-hero");
    expect(neutral).not.toMatch(/Ana ekran yükleniyor|PanelIskelet|_home\//);
  });

  it("DashboardGrid iskelet/içerik takaslarında stagger kapalıdır; liste girişi ve ilk açılış sayfa animasyonu yok", () => {
    const src = read("src/app/app/(bugun)/page.tsx");
    expect(src).not.toMatch(/<DashboardGrid(?![^>]*stagger=\{false\})[^>]*>/);
    const motion = read("src/app/motion.css");
    expect(motion).not.toMatch(/\.list-stagger\s*>\s*\*\s*\{\s*animation:\s*list-in/);
    // Sayfa geçişi yalnız yumuşak gezinmede (ilk açılışta içerik ilk karede tam opak).
    expect(motion).toMatch(/html\[data-soft-nav\] \.motion-page \{ animation:/);
    expect(motion).not.toMatch(/^\s*\.motion-page \{ animation:/m);
  });

  it("kabuk Suspense dışında; layout'ta en çok 3 sınır, bildirim zili akışı aynen", () => {
    const layout = read("src/app/app/layout.tsx");
    expect(count(layout, /<Suspense\b/g)).toBeLessThanOrEqual(3);
    for (const slice of ["ShellSidebar", "ShellHeader", "ShellTabs", "ShellBoot"]) {
      expect(layout, slice).toMatch(new RegExp(`^\\s*<${slice} />$`, "m"));
      expect(layout, slice).not.toMatch(new RegExp(`<Suspense[^>]*>\\s*<${slice}\\b`));
    }
    expect(layout).toMatch(/<Suspense fallback=\{<NotificationBell initial=\{\[\]\} \/>\}>\s*<NotificationBellStream \/>/);
    expect(layout).toContain("<StreamRevealBoot />");
  });

  it("ana ekranın ilk ekran blokları kapı sınırında: ayrı Suspense yok, yedek gerçek ızgarayı çizer", () => {
    const src = read("src/app/app/(bugun)/page.tsx");
    // Sadeleştirme planı 2.4 (bilinçli güncelleme): ilk ekran blokları artık "Bugünüm" (danışman) ve "Senden bekleyenler"
    // + "Para" (yönetim); Dikkat/Brifing/BugunOfiste katlı özet bölümüne taşındı.
    for (const block of ["Bugunum", "BugunKisayol", "SendenBekleyenler", "ParaOzeti", "Tahsilat"]) {
      expect(src, block).not.toMatch(new RegExp(`<Suspense[^>]*>\\s*(<FadeSwap[^>]*>\\s*)?<${block}\\b`));
    }
    expect(src).toContain("skeletonRows");
    // Yetki kartı (B041): pano kapısından ÖNCE döner.
    expect(src.indexOf('if (yetki === "yok")')).toBeGreaterThan(0);
    expect(src.indexOf('if (yetki === "yok")')).toBeLessThan(src.indexOf('requireModulePage("dashboard")'));
  });

  it("realtime kancası subscribe() içinde refresh çağırmaz; yalnız YENİDEN katılımda (ilk SUBSCRIBED değil) tazeleme ister", () => {
    const src = read("src/hooks/use-realtime-refresh.ts");
    const subscribeIdx = src.indexOf("ch.subscribe(");
    expect(subscribeIdx).toBeGreaterThan(0);
    const body = src.slice(subscribeIdx, src.indexOf("});", subscribeIdx));
    expect(body).not.toContain("router.refresh");
    expect(body).toMatch(/if \(joinedOnce\) onRejoin\?\.\(\);/);
  });
});
