/**
 * Public yüzeylerde (paylaşım linki, sunum, vitrin, danışman sayfası, portallar) gösterilebilecek portföy
 * görseli kuralı — TEK KAYNAK (KVKK P0-9).
 *
 * Bugün `property_media` tablosunda belge/ilan görseli ayrımı yapan bir sütun YOK (K4 dalındaki `is_document`
 * migration'ı main'de değil). Bu yüzden kural savunma katmanlıdır:
 *   1) yalnız `kind = 'image'` ve doğrulanmış görsel MIME türü,
 *   2) dosya adı belge gibi görünen (tapu, yetki belgesi, ruhsat, kimlik, sözleşme...) kayıt public'e ÇIKMAZ.
 * Hem sorgu tarafında (galeri listesi) hem servis eden public uçlarda (`/api/property-media/[id]` ve
 * `/private`) aynı fonksiyon uygulanır; liste atlansa bile dosya servis edilmez.
 *
 * SINIR: telefondan "IMG_1234.jpg" adıyla yüklenmiş tapu fotoğrafı ad üzerinden ayırt edilemez. Kalıcı çözüm
 * `is_document` sütunu + yükleme anında tür seçimidir (sahip kararı, migration gerekir). Sütun geldiğinde
 * yalnız `isPublicListingImage` güncellenir.
 */

export const PUBLIC_IMAGE_MIME_RE = /^image\/(?:avif|gif|jpeg|png|webp)$/i;

/**
 * Belge çağrıştıran ad parçaları (ASCII'ye indirgenmiş, küçük harf). "plan" gibi ilan görselinde de geçen
 * kelimeler bilinçli olarak YOK (kat planı yayın görselidir).
 */
const DOCUMENT_NAME_TOKENS = [
  "tapu",
  "yetki",
  "ruhsat",
  "iskan",
  "kimlik",
  "nufus",
  "ehliyet",
  "pasaport",
  "vekalet",
  "sozlesme",
  "kontrat",
  "dekont",
  "fatura",
  "makbuz",
  "ekspertiz",
  "belge",
  "evrak",
  "imza",
  "taahhut",
] as const;

function asciiFold(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}

/** Dosya adı belge gibi mi görünüyor (tapu, yetki belgesi, kimlik...)? Boş ad -> hayır. */
export function looksLikeDocumentFileName(fileName: string | null | undefined): boolean {
  const n = asciiFold(fileName ?? "");
  if (!n) return false;
  return DOCUMENT_NAME_TOKENS.some((t) => n.includes(t));
}

export type PublicMediaCandidate = {
  kind?: string | null;
  file_type?: string | null;
  file_name?: string | null;
};

/**
 * Public yüzeyde gösterilebilir ilan görseli mi? `file_type` seçilmediyse (eski sorgu) MIME kontrolü
 * servis eden uçta yapılır; burada yalnız tür + ad kuralı uygulanır.
 */
export function isPublicListingImage(m: PublicMediaCandidate): boolean {
  if (m.kind !== "image") return false;
  if (m.file_type != null && !PUBLIC_IMAGE_MIME_RE.test(m.file_type)) return false;
  return !looksLikeDocumentFileName(m.file_name);
}
