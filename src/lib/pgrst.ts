/**
 * PostgREST filtre dizgesi yardımcıları.
 *
 * NEDEN: `.or("a.ilike.%foo%,b.ilike.%foo%")` çağrılarında kullanıcı metni
 * doğrudan dizgeye gömülüyor. PostgREST'in `or` grameri virgülü ayraç,
 * parantezi gruplama, noktayı ise operatör ayracı sayar. Kullanıcı bunlardan
 * birini yazdığında filtre bozulur — sorgu ya hata verir ya da beklenmedik
 * satırlar döner.
 *
 * Kod tabanında iki ayrı yerde iki ayrı (ve her biri eksik) temizleme vardı:
 *   actions/search.ts        → `[%_,]` siliyor, `().:\"` bırakıyordu
 *   api/admin/search/route   → `[(),.*:\\]` siliyor, `%_` bırakıyordu
 * `%` ve `_` bırakılınca kullanıcı `%` yazıp tüm kayıtları çekebiliyordu.
 * Tek yerde toplandı.
 */

/**
 * `ilike` deseni üretir. Hem PostgREST gramerini bozan karakterleri hem de
 * LIKE joker karakterlerini (`%`, `_`) temizler.
 */
export function safeLike(raw: string, maxLen = 80): string {
  const cleaned = raw
    .slice(0, maxLen)
    // PostgREST grameri: , . ( ) : * \ " ve LIKE jokerleri: % _
    .replace(/[,.():*\\"%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `%${cleaned}%`;
}

/**
 * Birden çok kolonda `ilike` OR filtresi kurar.
 *
 *   orIlike(["title", "code"], "ev")  →  'title.ilike."%ev%",code.ilike."%ev%"'
 *
 * Değerler çift tırnak içinde: içindeki boşluk ayraç sanılmasın diye.
 * `safeLike` tırnağı zaten temizlediği için tırnaktan kaçış gerekmiyor.
 */
export function orIlike(columns: string[], raw: string, maxLen = 80): string {
  const like = safeLike(raw, maxLen);
  return columns.map((c) => `${c}.ilike."${like}"`).join(",");
}

/**
 * `id.in.(uuid,uuid)` parçası üretir; liste boşsa null döner ki çağıran
 * tarafta koşulu hiç eklemesin (`in.()` PostgREST'te sözdizimi hatasıdır).
 */
export function inFilter(column: string, ids: string[]): string | null {
  const valid = ids.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id));
  if (valid.length === 0) return null;
  return `${column}.in.(${valid.join(",")})`;
}

/* ------------------------------------------------------------------------------------------------
 * Müşteri arama çekirdeği (SK7 / B059 + B060) — liste, palet, /app/ara, seçici ve mükerrer aynı yoldan.
 * Saf modül: istemciden de içe aktarılabilir (phone-rules YÜKLENMEZ).
 * ---------------------------------------------------------------------------------------------- */

/** SQL `public.fold_tr` (20260725000056) ile birebir: Türkçe harfler ÖNCE düzleşir, sonra küçültme, U+0307 atılır. */
const FOLD_TR_SQL: Record<string, string> = {
  İ: "i", I: "i", ı: "i", Ğ: "g", ğ: "g", Ü: "u", ü: "u", Ş: "s", ş: "s",
  Ö: "o", ö: "o", Ç: "c", ç: "c", Â: "a", â: "a", Î: "i", î: "i", Û: "u", û: "u",
};

/**
 * `customers.search_fold` ile aynı katlama: "Kemal IŞIK" → "kemal isik", "Çağlar" → "caglar", "SELİN@x.com" → "selin@x.com".
 * Sunucudaki üretilmiş sütunla aynı kuralı izler; değiştirirsen migration'daki fold_tr'yi de değiştir (sözleşme testi kilitler).
 */
export function foldTrSql(raw: string): string {
  return raw
    .replace(/[İIıĞğÜüŞşÖöÇçÂâÎîÛû]/g, (ch) => FOLD_TR_SQL[ch] ?? ch)
    .toLowerCase()
    .replace(/\u0307/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PHONE_INPUT = /^[+\d\s().\-/]+$/;
/** Telefon sayılması için en az rakam (kısmi numara araması: son 7+ hane). */
export const PHONE_NEEDLE_MIN_DIGITS = 7;

/**
 * Telefon görünümlü girdiden `phone_digits` arama iğnesi (yalnız rakam): TR'de baştaki 0 / 90 / 0090 düşer → yerel ≤10 hane.
 * "0532 111 22 33", "05321112233", "+90 532 111 22 33", "+905321112233", "90 532 111 2233", "(532) 111-22-33" → "5321112233".
 * Harf içeren ya da 7 haneden kısa girdi telefon değildir (null; ad/e-posta aramasıdır).
 */
export function phoneDigitsNeedle(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s || !PHONE_INPUT.test(s)) return null;
  let digits = s.replace(/\D/g, "");
  if (digits.length < PHONE_NEEDLE_MIN_DIGITS) return null;
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (s.startsWith("+90") || (digits.startsWith("90") && digits.length === 12)) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < PHONE_NEEDLE_MIN_DIGITS) return null;
  return digits.slice(-10);
}

/** Tırnaklı PostgREST değerinde ve LIKE deseninde anlamı olan karakterler atılır (`*` PostgREST'te `%` yerine geçer). */
function likeSafe(value: string): string {
  return value.replace(/["\\%_*]/g, " ").replace(/\s+/g, " ").trim();
}

export type SearchTermColumns = { fold: string; digits: string };
const CUSTOMER_SEARCH_COLUMNS: SearchTermColumns = { fold: "search_fold", digits: "phone_digits" };

/**
 * TEK arama süzgeci (`.or(...)` dizgesi): telefon görünümlü girdi YALNIZ `phone_digits`'te, diğerleri Türkçe katlamalı
 * `search_fold`'da (ad + e-posta) aranır; 3+ rakam içeren metin ayrıca telefon rakamlarında da aranır ("532").
 * Boş/anlamsız girdide null (çağıran süzgeç eklemez). Değerler çift tırnaklı: boşluk, nokta, @ güvenle geçer.
 */
export function searchTermFilter(raw: string, columns: SearchTermColumns = CUSTOMER_SEARCH_COLUMNS, maxLen = 120): string | null {
  const term = String(raw ?? "").slice(0, maxLen).trim();
  if (!term) return null;
  const needle = phoneDigitsNeedle(term);
  if (needle) return `${columns.digits}.ilike."%${needle}%"`;
  const parts: string[] = [];
  const folded = likeSafe(foldTrSql(term));
  if (folded) parts.push(`${columns.fold}.ilike."%${folded}%"`);
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 3) parts.push(`${columns.digits}.ilike."%${digits}%"`);
  return parts.length > 0 ? parts.join(",") : null;
}
