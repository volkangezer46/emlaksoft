import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSiteMenu } from "./defaults";
import { isMenuIconName } from "./icon-registry";
import { PREVIEW_LABELS, previewForHref, sectionIconName } from "./previews";
import { toPublicMenu } from "./public";
import { FEATURED_PREVIEWS } from "./schema";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("mega menü canlı önizleme eşlemesi", () => {
  it("bilinen hedefler doğru sahneye gider; ilk eşleşen kazanır", () => {
    expect(previewForHref("/#kayip-kacak")).toBe("leak");
    expect(previewForHref("/fiyatlar#kacan-komisyon")).toBe("leak");
    expect(previewForHref("/#emsal-degerleme")).toBe("valuation");
    expect(previewForHref("/#degerleme")).toBe("valuation");
    expect(previewForHref("/#imza")).toBe("signature");
    expect(previewForHref("/#ai-asistan")).toBe("assistant");
    expect(previewForHref("/#portal-kontrol")).toBe("listing");
    expect(previewForHref("/#guvenlik")).toBe("security");
    expect(previewForHref("/kvkk-aydinlatma")).toBe("security");
    expect(previewForHref("/#otomasyon")).toBe("automation");
    expect(previewForHref("/#tur")).toBe("dashboard");
    expect(previewForHref("/fiyatlar")).toBe("plans");
    expect(previewForHref("/kayit?plan=office")).toBe("plans");
  });

  it("eşleşmeyen ve iletişim bağlantıları önizleme üretmez (varsayılan katman kalır)", () => {
    expect(previewForHref("mailto:destek@emlaksoft.com.tr")).toBeNull();
    expect(previewForHref("/#vitrin")).toBeNull();
    expect(previewForHref("")).toBeNull();
  });

  it("her önizleme türünün admin etiketi var; sütun ikonları kontrollü ikon listesinde", () => {
    for (const k of FEATURED_PREVIEWS) expect(PREVIEW_LABELS[k], k).toBeTruthy();
    for (const title of ["Satış ve kazanç", "Otomasyon ve ofis", "Ofis büyüklüğüne göre", "Karar vermek için", "Öğrenin", "Yasal ve destek", "Fiyatlandırma"]) {
      const name = sectionIconName(title);
      expect(name, title).not.toBeNull();
      expect(isMenuIconName(name!), title).toBe(true);
    }
  });

  it("varsayılan menüde öne çıkan kartı olan her grubun en az bir önizlemesi olur", () => {
    const menu = toPublicMenu(defaultSiteMenu(), 0);
    for (const g of menu.groups.filter((x) => x.kind === "menu" && x.featured && !x.featured.media)) {
      const kinds = g.columns.flatMap((c) => c.items.map((it) => previewForHref(it.href))).filter(Boolean);
      expect(g.featured!.preview ?? kinds[0], g.id).toBeTruthy();
    }
  });

  it("sahne kodu istemci paketine girmez; sahnelerde sabit renk yok (token)", () => {
    const client = read("src/components/site-menu/mega-menu.tsx");
    expect(client).not.toMatch(/from\s+["']\.\/(featured-preview|client-groups)["']/);
    const scenes = read("src/components/site-menu/featured-preview.tsx");
    expect(scenes.startsWith('"use client"')).toBe(false);
    expect(scenes).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    // site üst barı ve admin önizlemesi aynı dönüştürücüyü kullanır (kopya eşleme yok)
    expect(read("src/components/site-header.tsx")).toContain("toClientGroups(menu)");
    expect(read("src/app/admin/site-menu/menu-preview.tsx")).toContain("toClientGroups(menu)");
  });
});
