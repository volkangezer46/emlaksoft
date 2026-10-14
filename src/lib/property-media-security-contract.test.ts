import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("property media security contract", () => {
  it("keeps the anonymous endpoint live-only, active-tenant-only and short cached", () => {
    const route = read("src/app/api/property-media/[id]/route.ts");
    expect(route).toContain('prop.status === "live"');
    expect(route).toContain("isPublicTenantActive(tenant?.status)");
    expect(route).toContain("image\\/(?:avif|gif|jpeg|png|webp)");
    expect(route).toContain("max-age=60");
    expect(route).toContain('"X-Content-Type-Options": "nosniff"');
  });

  it("keeps signed media private and tenant lifecycle scoped", () => {
    const route = read("src/app/api/property-media/[id]/private/route.ts");
    expect(route).toContain("verifyShortLivedPropertyMediaClaim");
    expect(route).toContain("isPublicTenantActive(tenant.status)");
    expect(route).toContain("private, no-store");
    expect(route).toContain("image\\/(?:avif|gif|jpeg|png|webp)");
    expect(route).toContain('failurePolicy: "deny"');
    expect(route).toContain("limit: 240");
  });

  it("renders every signed-token page dynamically without optimizer or private OG leakage", () => {
    const pages = [
      "src/app/paylas/[token]/page.tsx",
      "src/app/sunum/[token]/page.tsx",
      "src/app/musteri-portali/[token]/page.tsx",
      "src/app/malik-portali/[token]/page.tsx",
    ].map(read);

    for (const page of pages) {
      expect(page).toContain('export const dynamic = "force-dynamic"');
      expect(page).toContain("createShortLivedPropertyMediaUrl");
    }
    // Önizleme (YD2): sayfa metadata'sı görsel URL'i TAŞIMAZ (imzalı/kısa ömürlü medya adresi og:image'e sızmaz).
    // Görsel yalnız token kapısını her istekte yeniden değerlendiren, önbelleksiz dosya rotasından gelir; fotoğraf
    // public ilan görseli kuralından geçer ve sunucuda yeniden kodlanır (ham bayt/EXIF dışarı çıkmaz).
    expect(pages[0]).not.toContain("images: cover");
    expect(pages[0]).not.toMatch(/images:\s*\[/);
    expect(pages[1]).not.toMatch(/images:\s*\[/);
    for (const dir of ["paylas", "sunum"]) {
      for (const file of ["opengraph-image.tsx", "twitter-image.tsx"]) {
        const og = read(`src/app/${dir}/[token]/${file}`);
        expect(og).toContain('export const dynamic = "force-dynamic"');
        expect(og).toContain("renderPublicLinkOgImage");
        expect(og).not.toContain("revalidate");
      }
    }
    const ogLib = read("src/lib/public-link-og.ts");
    expect(ogLib).toContain("firstPublicImageByProperty");
    expect(ogLib).toContain("isPublicTenantActive");
    expect(ogLib).toContain(".rotate()");
    expect(ogLib).toContain("no-store");
    expect(ogLib).not.toContain("createShortLivedPropertyMediaUrl");
    expect(read("src/components/public/gallery-lightbox.tsx")).toContain("unoptimized");
    expect(pages.slice(1).every((page) => page.includes("unoptimized"))).toBe(true);
  });

  it("uses the canonical authorized endpoint for internal app previews", () => {
    const internalFiles = [
      "src/app/app/portfoyler/page.tsx",
      "src/app/app/talepler/[id]/page.tsx",
      "src/app/app/portfoyler/[id]/brosur/page.tsx",
      "src/app/app/portfoyler/[id]/property-media-manager.tsx",
      "src/app/app/ayarlar/filigran/watermark-form.tsx",
    ];
    for (const file of internalFiles) {
      expect(read(file)).toContain("/download");
    }

    const downloadRoute = read("src/app/api/property-media/[id]/download/route.ts");
    expect(downloadRoute).toContain('requirePermission("properties", "view")');
    expect(downloadRoute).toContain('.eq("tenant_id", gate.tenantId)');
    expect(downloadRoute).toContain("private, no-store");
  });
});
