import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * METİN SIĞMA sözleşmesi (statik; tarayıcılı karşılığı e2e/text-fit.spec.ts). Sahip: "yazılarda kayma olmasın; uzun yazı
 * varsa mantıklı olarak kısalt". Kurallar: tutarlar kısaltılmaz (kap genişliğine göre ölçeklenir), kullanıcı verisi satır
 * sınırı + title ile, çip/hap nowrap + üst genişlik, telefonda kısa yer tutucu, kurulum sonrası kart aynı ölçü.
 */
const read = (p: string) => readFileSync(p, "utf8");
const css = read("src/app/app/_home/kurumsal/home.css");
const rule = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, sel).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
};

describe("ana ekran: tutarlar kısaltılmaz, kap genişliğine göre ölçeklenir", () => {
  it("KPI, Ofis durumu karosu ve hedef kartı tutarı: nowrap + container query, ellipsis YOK", () => {
    for (const sel of [".kh-kpi-value", ".kh-tile-value", ".kh-goal-value"]) {
      const r = rule(sel);
      expect(r, sel).toContain("white-space: nowrap");
      expect(r, sel).toMatch(/font-size: clamp\([^)]*cqi/);
      expect(r, sel).not.toContain("text-overflow");
    }
    expect(rule(".kh-kpi-main")).toContain("container-type: inline-size");
    expect(css).toMatch(/\.kh-tile \{[^}]*container-type: inline-size/);
    expect(rule(".kh-goal-body")).toContain("container-type: inline-size");
  });

  it("Ofis durumu hapı daralırsa '…' ile biter; karo etiketleri kısa ve resmî", () => {
    const chip = rule(".kh-tile-chip");
    expect(chip).toContain("text-overflow: ellipsis");
    expect(chip).toContain("max-width: 100%");
    const blocks = read("src/app/app/_home/kurumsal/blocks.tsx");
    // v5 referansı: tam ad "Portal teyit bekleyen ilan" — karo etiketi iki satıra iner (line-clamp 2), kesilmez.
    expect(blocks).toContain('label: "Portal teyit bekleyen ilan"');
    expect(rule(".kh-tile-label")).toContain("-webkit-line-clamp: 2");
    expect(blocks).toContain('"Bugünkü görev"');
    expect(blocks).not.toContain("Portal teyidi bekleyen ilan");
    expect(blocks).not.toContain('"Bugün görevler"');
  });

  it("komut çubuğu yer tutucusu telefonda kısa (örnek listesi yalnız geniş ekranda)", () => {
    const src = read("src/app/app/_home/kurumsal/hero-arama.tsx");
    expect(src).toContain("useSyncExternalStore(subscribePhone, isPhone, () => true)");
    expect(src).toContain('placeholder={phone ? "Ne yapmak istiyorsun?"');
  });
});

describe("kurulum sonrası kart: aynı yer, aynı ölçü (CLS 0)", () => {
  it("kurulum kartı, üç rol kartı ve iskelet aynı ayrılmış yüksekliği paylaşır", () => {
    expect(css).toContain(".kh-setup, .kh-setup-skel { min-height: var(--kh-setup-h); }");
    expect(css).toMatch(/\.kh-setup, \.kh-setup-skel \{ --kh-setup-h: [\d.]+rem; \}/);
    const views = read("src/app/app/_home/kurumsal/views.tsx");
    // SetupCard ve PostSetupShell aynı kutu sınıfı
    expect(views.match(/className="kh-card kh-setup"/g)?.length).toBeGreaterThanOrEqual(2);
    for (const k of ["ofis-hedefi", "kisisel-hedef", "ay-sonu-kapanisi"]) expect(views).toContain(`kind="${k}"`);
    expect(views).toContain("Hedef belirleyin");
    expect(views).toContain('<span className="kh-goal-est">Tahmin</span>');
  });

  it("sayfa: kurulum %100 olunca BaslangicKarti yerini PostSetupBlock'a bırakır; muhasebede de aynı yuva", () => {
    const page = read("src/app/app/(bugun)/page.tsx");
    expect(page).toContain("const goal = <PostSetupBlock ctx={ctx} />;");
    expect(page).toContain("<BaslangicKarti ctx={ctx} compact done={goal} />");
    expect(page).toContain("{closeSlot ? kurulumVeHedef : null}");
    expect(page).toContain('{closeSlot ? <CardSkeleton className="kh-setup-skel" rows={3} /> : null}');
  });
});

describe("kabuk ve listeler", () => {
  it("üst çubuk arama metni blok + truncate (satır içi öğe kısaltılamaz, kısayol ipucunun altına taşıyordu)", () => {
    expect(read("src/components/app/command-search.tsx")).toContain('<span className="hidden min-w-0 truncate sm:block">');
    expect(read("src/components/admin/command-palette-trigger.tsx")).toContain("min-w-0 flex-1 truncate");
  });

  it("üst çubuk tazelik damgası: etiket ile saat arasında boşluk korunur (saat ayrı `.num` içinde)", () => {
    expect(read("src/components/app/app-topbar-trail.tsx")).toContain('Son güncelleme <span className="num">{formatTrTime(state.at)}</span>');
  });

  it("İlan teyit sağlığı: hiç teyitli ilan yokken '%0' değil '—'", () => {
    expect(read("src/app/app/_home/kurumsal/blocks.tsx")).toContain('s.healthPct === 0 && s.overdueListings > 0 ? "—"');
  });

  it("kahraman: özet en çok iki satır, yan panele nefes payı; hızlı işlemler tek satır", () => {
    expect(css).toContain(".kh-hero.has-aside .kh-hero-body { padding-right: 48px; }");
    expect(rule(".kh-hero-lead")).toBeTruthy();
    expect(css).toMatch(/@container \(min-width: 520px\) and \(max-width: 700px\) \{\s*\.kh-actions \{ flex-wrap: nowrap;/);
  });

  it("liste süzgeci: uzun seçenek adı etiket sütununu genişletmez", () => {
    const src = read("src/components/ui/list-kit/filter-field.tsx");
    expect(src).toContain("grid min-w-0 grid-cols-[minmax(0,1fr)]");
    expect(src).toContain("w-full min-w-0 truncate");
  });

  it("yer tutucular dar kutuda '…' ile biter (genel kural)", () => {
    expect(read("src/app/globals.css")).toMatch(/:placeholder-shown \{ text-overflow: ellipsis; \}/);
  });

  it("platform yan menüsü: rol rozeti daralabilir (daraltma düğmesinin altına taşmaz)", () => {
    const src = read("src/components/admin/admin-sidebar.tsx");
    expect(src).toContain('<span className="min-w-0 truncate">{roleLabel}</span>');
  });
});

describe("TV panosu üst şeridi", () => {
  const tv = read("src/app/app/pano-tv/tv.css");
  it("sahne sekmeleri eşit daralır ve '…' ile biter; etkin sekme daralmaz", () => {
    expect(tv).toMatch(/\.tv-scene-chip \{[^}]*flex: 0 1 auto;[^}]*text-overflow: ellipsis;/);
    expect(tv).toMatch(/\.tv-scene-chip\[data-on="true"\] \{\s*flex-shrink: 0;/);
  });
  it("1920 ve altı: hava açıklaması ve canlılık saati gizlenir (hava yazısı sekmelere binmez)", () => {
    expect(tv).toMatch(/@container \(max-width: 2100px\) \{\s*\.tv-weather small,\s*\.tv-live small \{\s*display: none;/);
  });
});
