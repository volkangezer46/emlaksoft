/**
 * Public yüzeylerde (paylaşım linki, sunum, vitrin, danışman sayfası, portallar) gösterilebilecek portföy
 * görseli kuralı — TEK KAYNAK (KVKK P0-9).
 *
 * Kalıcı işaret: `property_media.is_document` (migration 20261007000100). `true` olan medya hiçbir public
 * yüzeyde gösterilmez ve public servis uçlarından servis edilmez. Kural katmanları:
 *   1) yalnız `kind = 'image'` ve doğrulanmış görsel MIME türü,
 *   2) `is_document === true` -> ASLA public,
 *   3) sütun yoksa (migration öncesi ortam; `is_document` undefined/null) dosya adı belge gibi görünen
 *      (tapu, yetki belgesi, ruhsat, kimlik, sözleşme...) kayıt public'e ÇIKMAZ (geçici ad kuralı).
 * Sütun varken ad kuralı yeni kayıtlara DB tetikleyicisiyle (`is_document=true`) uygulanır; ofis bir yanlış
 * pozitifi bilinçli olarak "Fotoğraf"a çevirebilir. Hem sorgu tarafında (galeri listesi, kapak seçimi) hem
 * servis eden public uçlarda (`/api/property-media/[id]` ve `/private`) aynı fonksiyon uygulanır; liste
 * atlansa bile dosya servis edilmez. Sorgular `selectWithDocumentFlag` ile sütunu seçer; sütun yoksa sorgu
 * sütunsuz tekrarlanır (kırılmaz, ad kuralına düşer).
 */

export const PUBLIC_IMAGE_MIME_RE = /^image\/(?:avif|gif|jpeg|png|webp)$/i;

/**
 * Belge çağrıştıran ad parçaları (ASCII'ye indirgenmiş, küçük harf). "plan" gibi ilan görselinde de geçen
 * kelimeler bilinçli olarak YOK (kat planı yayın görselidir). SQL eşi (BİREBİR aynı liste):
 * `public.media_file_name_looks_like_document` (migration 20261007000100); sözleşme testi ikisini karşılaştırır.
 */
export const DOCUMENT_NAME_TOKENS = [
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
  /** `property_media.is_document`; undefined/null = sütun yok (migration öncesi) -> ad kuralı. */
  is_document?: boolean | null;
};

/**
 * Medya belge mi? Sütun varsa (boolean) o esastır; yoksa dosya adı kuralı. Ofis içi ekranlar (medya
 * yöneticisi, belgeler) ayrımı da bununla gösterir.
 */
export function isDocumentMedia(m: Pick<PublicMediaCandidate, "is_document" | "file_name">): boolean {
  if (typeof m.is_document === "boolean") return m.is_document;
  return looksLikeDocumentFileName(m.file_name);
}

/**
 * Public yüzeyde gösterilebilir ilan görseli mi? `file_type` seçilmediyse (eski sorgu) MIME kontrolü
 * servis eden uçta yapılır; burada tür + belge işareti (sütun yoksa ad kuralı) uygulanır.
 */
export function isPublicListingImage(m: PublicMediaCandidate): boolean {
  if (m.kind !== "image") return false;
  if (m.file_type != null && !PUBLIC_IMAGE_MIME_RE.test(m.file_type)) return false;
  return !isDocumentMedia(m);
}

/** Kapak seçimi sorgularının sütunları (kural için tür + MIME + ad; `is_document` `selectWithDocumentFlag` ile eklenir). */
export const PUBLIC_COVER_COLUMNS = "id, property_id, kind, file_type, file_name";

export type PublicCoverCandidate = PublicMediaCandidate & { id: string; property_id: string };

/**
 * Sıralı medya satırlarından (is_cover desc, sort_order asc) her portföy için İLK public görselin id'si.
 * Belge kapak olsa bile atlanır ve bir sonraki ilan görseline düşülür (kapak boş kalmaz, belge sızmaz).
 */
export function firstPublicImageByProperty(
  rows: readonly PublicCoverCandidate[] | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of rows ?? []) {
    if (!map.has(m.property_id) && isPublicListingImage(m)) map.set(m.property_id, m.id);
  }
  return map;
}

/**
 * Yükleme türü "Belge" seçildiğinde kaydedilecek dosya adı: ad belge çağrıştırmıyorsa `belge-` öneki eklenir.
 * Böylece sütun yokken ad kuralı, sütun varken INSERT tetikleyicisi belgeyi İLK ANDAN işaretler (arada public
 * görünme penceresi olmaz).
 */
export function documentUploadFileName(fileName: string): string {
  const name = String(fileName ?? "").trim() || "belge.jpg";
  return looksLikeDocumentFileName(name) ? name : `belge-${name}`;
}

export type MediaQueryError = { code?: string | null; message?: string | null };

/** "is_document sütunu yok" hatası mı (migration 20261007000100 uygulanmamış)? PG 42703 / PostgREST PGRST204. */
export function isMissingDocumentColumnError(error: MediaQueryError | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("is_document") &&
    (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"))
  );
}

/** Seçim listesine `is_document` ekler (yalnız `include` true ise). */
export function withDocumentColumn(columns: string, include: boolean): string {
  return include ? `${columns}, is_document` : columns;
}

/**
 * `property_media` sorgusunu `is_document` sütunuyla çalıştırır; sütun yoksa AYNI sorguyu sütunsuz tekrarlar
 * (satırlarda `is_document` olmaz -> `isPublicListingImage` ad kuralına düşer). Başka hata olduğu gibi döner
 * (çağıran fail-closed davranır: veri yok = görsel yok). `run` sorgu kurucusudur ve verilen sütunları seçer.
 */
export async function selectWithDocumentFlag<T>(
  columns: string,
  run: (columns: string) => PromiseLike<{ data: unknown; error: MediaQueryError | null }>,
): Promise<{ data: T | null; error: MediaQueryError | null; hasDocumentColumn: boolean }> {
  const first = await run(withDocumentColumn(columns, true));
  if (!first.error) return { data: (first.data ?? null) as T | null, error: null, hasDocumentColumn: true };
  if (!isMissingDocumentColumnError(first.error)) {
    return { data: null, error: first.error, hasDocumentColumn: true };
  }
  const plain = await run(columns);
  return { data: (plain.data ?? null) as T | null, error: plain.error ?? null, hasDocumentColumn: false };
}
