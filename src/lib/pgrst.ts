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
