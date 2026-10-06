import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_NAME_TOKENS,
  documentUploadFileName,
  firstPublicImageByProperty,
  isDocumentMedia,
  isMissingDocumentColumnError,
  isPublicListingImage,
  looksLikeDocumentFileName,
  selectWithDocumentFlag,
} from "./public-property-media";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const MIGRATION = "supabase/migrations/20261007000100_property_media_is_document.sql";

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

describe("is_document işareti (kalıcı çözüm, migration 20261007000100)", () => {
  it("is_document === true ise ad ne olursa olsun public değil", () => {
    expect(isPublicListingImage({ kind: "image", file_type: "image/jpeg", file_name: "IMG_1234.jpg", is_document: true })).toBe(false);
  });

  it("sütun varken işaret esastır (ofis yanlış pozitifi bilinçli kaldırabilir); yoksa ad kuralı", () => {
    expect(isPublicListingImage({ kind: "image", file_type: "image/jpeg", file_name: "tapu-manzara.jpg", is_document: false })).toBe(true);
    expect(isPublicListingImage({ kind: "image", file_type: "image/jpeg", file_name: "tapu.jpg", is_document: null })).toBe(false);
    expect(isPublicListingImage({ kind: "image", file_type: "image/jpeg", file_name: "tapu.jpg" })).toBe(false);
    expect(isDocumentMedia({ file_name: "salon.jpg" })).toBe(false);
  });

  it("Belge türünde yükleme adı belge önekiyle kaydedilir (ad kuralı/tetikleyici ilk andan yakalar)", () => {
    expect(documentUploadFileName("IMG_1234.jpg")).toBe("belge-IMG_1234.jpg");
    expect(documentUploadFileName("Tapu.jpg")).toBe("Tapu.jpg");
    expect(looksLikeDocumentFileName(documentUploadFileName("DSC0001.png"))).toBe(true);
  });

  it("kapak seçimi belgeyi atlar ve sıradaki ilan görseline düşer", () => {
    const map = firstPublicImageByProperty([
      { id: "a", property_id: "p1", kind: "image", file_type: "image/jpeg", file_name: "IMG_1.jpg", is_document: true },
      { id: "b", property_id: "p1", kind: "image", file_type: "image/jpeg", file_name: "IMG_2.jpg", is_document: false },
      { id: "c", property_id: "p2", kind: "image", file_type: "image/jpeg", file_name: "tapu.jpg" },
    ]);
    expect(map.get("p1")).toBe("b");
    expect(map.has("p2")).toBe(false);
  });

  it("sütun yoksa sorgu sütunsuz tekrarlanır; başka hata olduğu gibi döner (fail-closed)", async () => {
    const calls: string[] = [];
    const missing = await selectWithDocumentFlag<{ id: string }[]>("id, file_name", async (cols) => {
      calls.push(cols);
      return cols.includes("is_document")
        ? { data: null, error: { code: "42703", message: "column property_media.is_document does not exist" } }
        : { data: [{ id: "x" }], error: null };
    });
    expect(calls).toEqual(["id, file_name, is_document", "id, file_name"]);
    expect(missing).toMatchObject({ data: [{ id: "x" }], error: null, hasDocumentColumn: false });

    const other = await selectWithDocumentFlag("id", async () => ({ data: null, error: { code: "57014", message: "timeout" } }));
    expect(other).toMatchObject({ data: null, hasDocumentColumn: true });
    expect(other.error?.code).toBe("57014");

    expect(isMissingDocumentColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingDocumentColumnError({ code: "42501", message: "permission denied" })).toBe(false);
  });

  it("SQL ad kuralı TS listesiyle BİREBİR aynı (iki kaynak kaymasın)", () => {
    const sql = read(MIGRATION);
    const fn = sql.slice(sql.indexOf("create or replace function public.media_file_name_looks_like_document"));
    const sqlTokens = [...fn.slice(0, fn.indexOf("$$;")).matchAll(/'%([a-z]+)%'/g)].map((m) => m[1]);
    expect(sqlTokens).toEqual([...DOCUMENT_NAME_TOKENS]);
  });

  it("migration: sütun not null default false, RLS'e dokunmaz, tetikleyici yalnız INSERT", () => {
    const sql = read(MIGRATION);
    expect(sql).toMatch(/add column if not exists is_document boolean not null default false/);
    expect(sql).toMatch(/before insert on public\.property_media/);
    expect(sql).not.toMatch(/before (insert or )?update|policy/i);
    expect(read("supabase/rollbacks/20261007000100_property_media_is_document.rollback.sql")).toMatch(/drop column if exists is_document/);
  });
});

/**
 * Public (ve dışarı verilen) medya yüzeyleri: her `property_media` sorgusu `selectWithDocumentFlag` içinden
 * geçer (is_document seçilir) ve satırlar `isPublicListingImage` / `firstPublicImageByProperty` ile süzülür.
 */
const PUBLIC_MEDIA_SURFACES = [
  "src/app/api/property-media/[id]/route.ts",
  "src/app/api/property-media/[id]/private/route.ts",
  "src/app/api/vitrin-favoriler/route.ts",
  "src/app/paylas/[token]/page.tsx",
  "src/app/sunum/[token]/page.tsx",
  "src/app/vitrin/[slug]/page.tsx",
  "src/app/vitrin/[slug]/[id]/page.tsx",
  "src/app/danisman/[slug]/page.tsx",
  "src/app/malik-portali/[token]/page.tsx",
  "src/app/musteri-portali/[token]/page.tsx",
  // Ofis içi ama dışarı verilen: basılı broşür + ofis TV'si
  "src/app/app/portfoyler/[id]/brosur/page.tsx",
  "src/lib/tv/tv-data.ts",
];

function walk(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(join(process.cwd(), rel)).isDirectory() ? walk(rel) : [rel];
  });
}

describe("sözleşme: public yüzeyler aynı kuralı kullanır", () => {
  it.each(PUBLIC_MEDIA_SURFACES)("%s: her property_media sorgusu is_document seçer ve kuralla süzer", (f) => {
    const src = read(f);
    const hits = [...src.matchAll(/\.from\("property_media"\)/g)];
    expect(hits.length, f).toBeGreaterThan(0);
    for (const h of hits) {
      const before = src.slice(Math.max(0, (h.index ?? 0) - 400), h.index);
      expect(before, `${f}: property_media sorgusu selectWithDocumentFlag dışında`).toContain("selectWithDocumentFlag");
    }
    expect(/isPublicListingImage\(|firstPublicImageByProperty\(/.test(src), f).toBe(true);
  });

  it("public servis uçları (açık + imzalı) dosya adını seçer ve kuralı uygular", () => {
    for (const f of ["src/app/api/property-media/[id]/route.ts", "src/app/api/property-media/[id]/private/route.ts"]) {
      const src = read(f);
      expect(src, f).toContain("isPublicListingImage(media)");
      expect(src, f).toMatch(/selectWithDocumentFlag<MediaRow>\(\s*"kind, storage_path, file_type, file_name/);
    }
    // Eski türsüz süzgeç geri gelmesin.
    expect(read("src/app/paylas/[token]/page.tsx")).not.toContain('media.filter((m) => m.kind === "image")');
  });

  it("src/app altında property_media okuyan her ofis-dışı dosya bu listede (yeni public yüzey kuraldan kaçamaz)", () => {
    const internal = /^src\/app\/(app|admin|actions)\//;
    const files = walk("src/app")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => !internal.test(f))
      // Oturumlu, tenant kapılı ofis içi indirme ucu (public değil).
      .filter((f) => f !== "src/app/api/property-media/[id]/download/route.ts")
      .filter((f) => read(f).includes('.from("property_media")'));
    expect(files.filter((f) => !PUBLIC_MEDIA_SURFACES.includes(f))).toEqual([]);
  });
});

describe("sözleşme: yükleme ve medya yöneticisi belge ayrımını sunar", () => {
  it("yüklemede tür seçimi (Fotoğraf / Belge) ve işaret action'ı bağlı", () => {
    const ui = read("src/app/app/portfoyler/[id]/property-media-manager.tsx");
    expect(ui).toContain('aria-label="Yükleme türü"');
    expect(ui).toContain("isDocument: item.asDocument");
    expect(ui).toContain("setPropertyMediaDocument(");
    expect(ui).toContain("Dışarıda gösterilmez");
    const actions = read("src/app/actions/property-media.ts");
    expect(actions).toContain("documentUploadFileName(input.fileName)");
    expect(actions).toMatch(/export async function setPropertyMediaDocument\(/);
    // Belge kapak yapılamaz.
    expect(actions).toMatch(/if \(!target \|\| !isPublicListingImage\(target\)\) return;/);
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
