import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { DEMO_BANNER_MEMBER_NOTE, DemoTrialStrip, resolveDemoMode } from "./demo-trial-strip";

/**
 * Demo şeridi sözleşmesi: YALNIZ demo modunda çizilir; rol ayrımı (sahip/GM: geçiş CTA'sı, diğerleri: bilgi notu);
 * kabukta sunucu bileşeni olarak (istemci JS yok) bağlanır.
 */
const html = (props: Parameters<typeof DemoTrialStrip>[0]) => renderToStaticMarkup(createElement(DemoTrialStrip, props));

describe("demo şeridi", () => {
  it("gerçek kullanımda ve deneme yokken HİÇ çizilmez", () => {
    expect(html({ mode: null, trialDaysLeft: null, canSwitch: true })).toBe("");
  });

  it("demo modunda başlık + metin; sahip/GM: Gerçek kullanıma geç + Demo turu", () => {
    const out = html({ mode: "sample", trialDaysLeft: null, canSwitch: true });
    expect(out).toContain("Demo ofisindesiniz");
    expect(out).toContain("gördüğünüz kayıtlar örnektir");
    expect(out).toContain('href="/app/ayarlar/gercek-kullanim"');
    expect(out).toContain('href="/app?tur=1"');
    expect(out).not.toContain(DEMO_BANNER_MEMBER_NOTE);
  });

  it("diğer roller: geçiş bağlantısı YOK, yöneticinin sileceği notu VAR", () => {
    const out = html({ mode: "sample", trialDaysLeft: 9, canSwitch: false });
    expect(out).not.toContain("gercek-kullanim");
    expect(out).toContain(DEMO_BANNER_MEMBER_NOTE);
    expect(out).toContain("9 gün deneme kaldı");
  });

  it("genel demo ofisi: Kendi ofisini aç, geçiş yok", () => {
    const out = html({ mode: "public", trialDaysLeft: null, canSwitch: true });
    expect(out).toContain('href="/kayit"');
    expect(out).not.toContain("gercek-kullanim");
  });

  it("mod kararı: örnek veri damgası ya da genel demo ofisi", () => {
    expect(resolveDemoMode({ sampleSeededAt: null, isPublicDemo: false })).toBeNull();
    expect(resolveDemoMode({ sampleSeededAt: "2026-10-01", isPublicDemo: false })).toBe("sample");
    expect(resolveDemoMode({ sampleSeededAt: null, isPublicDemo: true })).toBe("public");
  });

  it("kabukta sunucu tarafında bağlı; bileşen istemci dosyası değil", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/app/demo-trial-strip.tsx"), "utf8");
    expect(src).not.toMatch(/^\s*["']use client["']/m);
    const layout = readFileSync(resolve(process.cwd(), "src/app/app/layout.tsx"), "utf8");
    expect(layout).toMatch(/<DemoTrialStrip[\s\S]*mode=\{resolveDemoMode\(/);
  });
});
