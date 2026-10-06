import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brand, BrandProvider } from "@/components/brand/brand";
import { PLATFORM_ROLE_MODULES } from "@/lib/platform-access";
import { brandIcons } from "./icons";
import { checkBrandUpload, readPngSize } from "./upload-validation";
import { parseBrandMeta } from "./store";
import { EMPTY_BRAND_META, resolveBrandSrc, type BrandMeta } from "./slots";

const custom: BrandMeta = {
  slots: {
    "logo-light": { type: "svg", v: 11, bytes: 100 },
    mark: { type: "png", v: 12, bytes: 100 },
    favicon: { type: "png", v: 13, bytes: 100 },
  },
};

function png(w: number, h: number, extra = 0): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}

describe("resolveBrandSrc", () => {
  it("özel yükleme yoksa varsayılan dosyalara düşer", () => {
    expect(resolveBrandSrc(EMPTY_BRAND_META, "horizontal", "light")).toBe("/brand/logo-horizontal.svg");
    expect(resolveBrandSrc(EMPTY_BRAND_META, "horizontal", "dark")).toBe("/brand/logo-horizontal-dark.svg");
    expect(resolveBrandSrc(EMPTY_BRAND_META, "mark", "dark")).toBe("/brand/logo-mark-dark.svg");
    expect(resolveBrandSrc(EMPTY_BRAND_META, "vertical", "light")).toBe("/brand/logo-vertical.svg");
  });
  it("özel yükleme varsa sürümlü yolu kullanır; koyu logo yüklenmediyse açık logo koyu zeminde KULLANILMAZ", () => {
    expect(resolveBrandSrc(custom, "horizontal", "light")).toBe("/brand-asset/logo-light?v=11");
    expect(resolveBrandSrc(custom, "horizontal", "dark")).toBe("/brand/logo-horizontal-dark.svg");
    expect(resolveBrandSrc(custom, "mark", "light")).toBe("/brand-asset/mark?v=12");
  });
});

describe("Brand bileşeni", () => {
  it("varsayılan markayı <img> olarak render eder (inline SVG yok)", () => {
    const html = renderToStaticMarkup(createElement(Brand, { variant: "horizontal", tone: "dark", height: 30 }));
    expect(html).toContain('src="/brand/logo-horizontal-dark.svg"');
    expect(html).toContain('alt="EmlakSoft"');
    expect(html).not.toContain("<svg");
  });
  it("BrandProvider içindeki özel markayı kullanır", () => {
    const Provider = BrandProvider as (p: { meta: BrandMeta }) => ReturnType<typeof BrandProvider>;
    const html = renderToStaticMarkup(createElement(Provider, { meta: custom }, createElement(Brand, { variant: "mark", alt: "" })));
    expect(html).toContain('src="/brand-asset/mark?v=12"');
  });
  it("auto tonu açık ve koyu iki görsel üretir", () => {
    const html = renderToStaticMarkup(createElement(Brand, { tone: "auto" }));
    expect(html).toContain("/brand/logo-horizontal.svg");
    expect(html).toContain("/brand/logo-horizontal-dark.svg");
  });
});

describe("favicon metadata", () => {
  it("ayar yoksa varsayılan dosyalar", () => {
    const icons = brandIcons(EMPTY_BRAND_META) as { icon: { url: string }[] };
    expect(icons.icon[0].url).toBe("/icon.svg");
  });
  it("özel favicon sürümlü yoldan servis edilir", () => {
    const icons = brandIcons(custom) as { icon: { url: string }[]; apple: { url: string }[] };
    expect(icons.icon[0].url).toBe("/brand-asset/favicon?v=13");
    expect(icons.apple[0].url).toBe("/brand-asset/favicon?v=13");
  });
});

describe("meta ayrıştırma", () => {
  it("bozuk/yabancı veriyi yok sayar", () => {
    expect(parseBrandMeta(null)).toEqual(EMPTY_BRAND_META);
    expect(parseBrandMeta("{bozuk")).toEqual(EMPTY_BRAND_META);
    expect(parseBrandMeta('{"slots":{"x":{"type":"svg","v":1},"mark":{"type":"exe","v":1}}}')).toEqual(EMPTY_BRAND_META);
  });
});

describe("yükleme doğrulaması", () => {
  it("PNG imzasını ve boyutlarını kontrol eder", () => {
    expect(readPngSize(png(64, 64))).toEqual({ w: 64, h: 64 });
    expect(checkBrandUpload("favicon", png(64, 64)).ok).toBe(true);
    expect(checkBrandUpload("favicon", png(64, 32)).ok).toBe(false); // kare değil
    expect(checkBrandUpload("logo-light", png(400, 80)).ok).toBe(true);
    expect(checkBrandUpload("mark", png(8, 8)).ok).toBe(false); // çok küçük
    expect(checkBrandUpload("mark", png(4000, 4000)).ok).toBe(false); // çok büyük
    expect(checkBrandUpload("mark", png(64, 64, 300 * 1024)).ok).toBe(false); // bayt sınırı
  });
  it("PNG uzantılı sahte/ikili içeriği reddeder", () => {
    expect(checkBrandUpload("mark", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])).ok).toBe(false); // JPEG
    expect(checkBrandUpload("mark", new TextEncoder().encode("MZ\u0000\u0000binary")).ok).toBe(false);
    expect(checkBrandUpload("mark", new Uint8Array()).ok).toBe(false);
  });
  it("SVG: kare kuralı ve tehlikeli içerik", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(checkBrandUpload("favicon", enc('<svg viewBox="0 0 64 64"><rect width="64" height="64"/></svg>')).ok).toBe(true);
    expect(checkBrandUpload("favicon", enc('<svg viewBox="0 0 100 40"><rect/></svg>')).ok).toBe(false);
    expect(checkBrandUpload("logo-light", enc('<svg viewBox="0 0 100 40"><rect/></svg>')).ok).toBe(true);
    expect(checkBrandUpload("logo-light", enc('<svg viewBox="0 0 10 10"><script>1</script></svg>')).ok).toBe(false);
  });
});

describe("sözleşme: marka kayıtları ve tek Brand bileşeni", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("'marka' modülü yalnız süper adminde; menü ve komut paleti kayıtlı", () => {
    for (const [role, mods] of Object.entries(PLATFORM_ROLE_MODULES)) {
      expect(mods.includes("marka"), role).toBe(role === "super_admin");
    }
    // Menü ve komut paleti tek kaynaktan beslenir (src/lib/admin/nav.ts).
    expect(read("src/lib/admin/nav.ts")).toContain('L("/admin/marka", "Marka", "Logo ve favicon", ["marka"])');
    expect(read("src/components/admin/command-palette.tsx")).toContain("adminPaletteFor(modules)");
    expect(read("src/app/admin/marka/page.tsx")).toContain('requirePlatformModule("marka")');
    const actions = read("src/app/actions/platform-brand.ts");
    expect(actions.match(/requirePlatformModule\("marka"\)/g)?.length).toBe(2);
    expect(actions).toContain("checkRateLimit");
    expect(actions).toContain("logPlatformActivity");
    expect(actions).toContain("updateTag");
    expect(actions).not.toContain("createAdminClient");
  });

  it("logo gösteren kabuklar Brand bileşenini kullanır, elle çizilmiş 'E' kutusu kalmadı", () => {
    for (const f of [
      "src/components/site-header.tsx",
      "src/components/site-footer.tsx",
      "src/components/legal-page.tsx",
      "src/components/auth/auth-shell.tsx",
      "src/components/app/app-sidebar.tsx",
      "src/components/admin/admin-sidebar.tsx",
    ]) {
      expect(read(f), f).toContain("@/components/brand/brand");
    }
    expect(read("src/components/site-header.tsx")).not.toContain("<i aria-hidden=\"true\">E</i>");
    expect(read("src/components/site-footer.tsx")).not.toContain(">E</i>");
    expect(read("src/app/layout.tsx")).toContain("BrandProvider");
  });

  it("manifest ikonları gerçek dosyalara işaret eder ve maskable PNG içerir", () => {
    const m = JSON.parse(read("public/manifest.webmanifest")) as { icons: { src: string; purpose: string; type: string }[] };
    expect(m.icons.some((i) => i.purpose === "maskable" && i.type === "image/png")).toBe(true);
  });

  it("marka asset yolu güvenli başlıklar gönderir", () => {
    const route = read("src/app/brand-asset/[slot]/route.ts");
    expect(route).toContain("nosniff");
    expect(route).toContain("sandbox");
  });
});
