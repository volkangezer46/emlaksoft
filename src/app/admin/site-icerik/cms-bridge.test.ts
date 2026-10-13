import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PREVIEW_BRIDGE_JS } from "@/app/onizleme/ana-sayfa/bridge";
import { acceptCmsMessage, cmsFieldSelectors, cmsTabFor } from "./cms-bridge";
import { PreviewFrame } from "./preview-frame";

const frame = { name: "iframe-window" };
const other = { name: "baska-pencere" };

describe("önizleme postMessage işleyicisi", () => {
  it("yalnız bizim iframe penceresinden gelen, izin listesindeki yolu kabul eder", () => {
    expect(acceptCmsMessage({ source: frame, data: { type: "cms-select", path: "hero.title" } }, frame)).toBe("hero.title");
    expect(acceptCmsMessage({ source: frame, data: { type: "cms-select", path: "sections.sss.title" } }, frame)).toBe("sections.sss.title");
  });

  it("source uyuşmazlığı yok sayılır", () => {
    expect(acceptCmsMessage({ source: other, data: { type: "cms-select", path: "hero.title" } }, frame)).toBeNull();
    expect(acceptCmsMessage({ source: null, data: { type: "cms-select", path: "hero.title" } }, frame)).toBeNull();
    expect(acceptCmsMessage({ source: frame, data: { type: "cms-select", path: "hero.title" } }, null)).toBeNull();
  });

  it("izin listesi dışındaki yol ve yanlış tür yok sayılır", () => {
    for (const path of ["hero.primary.href", "layout", "__proto__", "hero.title.x", "v", "register.title", "hero.image.mediaId", 'hero.title"]', 42, null]) {
      expect(acceptCmsMessage({ source: frame, data: { type: "cms-select", path } }, frame), String(path)).toBeNull();
    }
    expect(acceptCmsMessage({ source: frame, data: { type: "cms-edit", path: "hero.title" } }, frame)).toBeNull();
    expect(acceptCmsMessage({ source: frame, data: "hero.title" }, frame)).toBeNull();
  });

  it("yol sekmeye eşlenir; alan seçicisi önce tam yol, sonra altındaki ilk alan", () => {
    expect(cmsTabFor("hero.image")).toBe("hero");
    expect(cmsTabFor("valueCards")).toBe("lists");
    expect(cmsTabFor("efSection.title")).toBe("ef");
    expect(cmsTabFor("finalCta.title")).toBe("final");
    expect(cmsTabFor("hero.primary.href")).toBeNull();
    expect(cmsFieldSelectors("faq")).toEqual(['[data-cms-field="faq"]', '[data-cms-field^="faq."]']);
  });
});

describe("önizleme iframe'i ve köprü", () => {
  it("iframe sandbox=allow-scripts; allow-same-origin YOK (render)", () => {
    const out = renderToStaticMarkup(createElement(PreviewFrame, { src: "/onizleme/ana-sayfa?t=x", width: 1280 }));
    expect(out).toContain('sandbox="allow-scripts"');
    expect(out).not.toContain("allow-same-origin");
    expect(out).toContain('src="/onizleme/ana-sayfa?t=x"');
  });

  it("yönetim ekranında allow-same-origin hiçbir yerde verilmez; iframe yalnız PreviewFrame'den", () => {
    const dir = join(process.cwd(), "src/app/admin/site-icerik");
    for (const f of readdirSync(dir).filter((x) => statSync(join(dir, x)).isFile() && /\.tsx$/.test(x))) {
      // Yorumlar hariç (açıklamada adı geçebilir); kodda hiçbir yerde olmamalı.
      const s = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(s, f).not.toContain("allow-same-origin");
      if (f !== "preview-frame.tsx") expect(s, f).not.toMatch(/<iframe/);
    }
  });

  it("köprü betiği ≤2 KB, yalnız iframe içinde çalışır ve cms-select gönderir", () => {
    expect(Buffer.byteLength(PREVIEW_BRIDGE_JS)).toBeLessThanOrEqual(2048);
    expect(PREVIEW_BRIDGE_JS).toContain("window.parent===window");
    expect(PREVIEW_BRIDGE_JS).toContain('parent.postMessage({type:"cms-select",path:');
    // İframe içinde düzenleme yok: contenteditable/form yazımı içermez.
    expect(PREVIEW_BRIDGE_JS).not.toMatch(/contenteditable|innerHTML|\.value=/i);
    const page = readFileSync(join(process.cwd(), "src/app/onizleme/ana-sayfa/page.tsx"), "utf8");
    expect(page).toContain("PREVIEW_BRIDGE_JS");
  });
});
