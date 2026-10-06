import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicListingImage, looksLikeDocumentFileName } from "./public-property-media";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("public portföy görseli kuralı (KVKK P0-9)", () => {
  it("belge çağrıştıran adlar public'e çıkmaz (Türkçe karakter dahil)", () => {
    for (const n of ["Tapu.jpg", "TAPU_FOTO.png", "yetki-belgesi.jpg", "Sözleşme.webp", "kimlik_on.jpg", "İskân ruhsatı.png", "nüfus.jpg"]) {
      expect(looksLikeDocumentFileName(n), n).toBe(true);
      expect(isPublicListingImage({ kind: "image", file_type: "image/jpeg", file_name: n }), n).toBe(false);
    }
  });

  it("olağan ilan görselleri geçer (kat planı dahil)", () => {
    for (const n of ["IMG_1234.jpg", "salon.jpg", "kat-plani.png", "cephe 2.webp", null]) {
      expect(isPublicListingImage({ kind: "image", file_type: "image/png", file_name: n }), String(n)).toBe(true);
    }
  });

  it("görsel olmayan tür/MIME geçmez", () => {
    expect(isPublicListingImage({ kind: "video", file_name: "a.mp4" })).toBe(false);
    expect(isPublicListingImage({ kind: "image", file_type: "application/pdf", file_name: "a.pdf" })).toBe(false);
  });
});

describe("sözleşme: public yüzeyler aynı kuralı kullanır", () => {
  it("public servis uçları (açık + imzalı) kuralı uygular", () => {
    for (const f of ["src/app/api/property-media/[id]/route.ts", "src/app/api/property-media/[id]/private/route.ts"]) {
      const src = read(f);
      expect(src, f).toContain("isPublicListingImage(media)");
      expect(src, f).toMatch(/select\("kind, storage_path, file_type, file_name/);
    }
  });

  it("paylaşım, sunum ve vitrin galerisi kuralla süzer ve dosya adını seçer", () => {
    for (const f of ["src/app/paylas/[token]/page.tsx", "src/app/sunum/[token]/page.tsx", "src/app/vitrin/[slug]/[id]/page.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("isPublicListingImage(");
      expect(src, f).toMatch(/\.from\("property_media"\)\s*\.select\("[^"]*file_name/);
    }
    // Eski türsüz süzgeç geri gelmesin.
    expect(read("src/app/paylas/[token]/page.tsx")).not.toContain('media.filter((m) => m.kind === "image")');
  });
});

describe("sözleşme: ofis bağlamı olmayan platform personeli ortak bildirimi görür", () => {
  const pages = [
    "src/app/app/pano-tv/page.tsx",
    "src/app/app/ayarlar/ai-kullanim/page.tsx",
    "src/app/app/ayarlar/moduller/page.tsx",
    "src/app/app/ayarlar/merkez/page.tsx",
    "src/app/app/baslangic/page.tsx",
    "src/app/app/buyume/page.tsx",
    "src/app/app/ekip/belgeler/page.tsx",
  ];
  it.each(pages)("%s StaffNoTenantNotice kullanır", (f) => {
    expect(read(f)).toContain("<StaffNoTenantNotice");
  });
  it("Pano TV yetki metni rolleri tek kaynaktan söyler, genel 'yetkiniz yok' metni yok", () => {
    const src = read("src/app/app/pano-tv/page.tsx");
    expect(src).not.toContain("Bu panoyu görme yetkiniz yok");
    expect(src).toContain("allowedRoles={TV_VIEW_ROLES}");
  });
});
