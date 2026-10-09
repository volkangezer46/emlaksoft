import type { User } from "@supabase/supabase-js";

/**
 * Proxy → sunucu bileşeni "bu istekte kimlik doğrulandı" işareti (SAF; hız turu 4, HAFIZA §30).
 *
 * Proje JWT'si asimetrik (ES256; `/auth/v1/.well-known/jwks.json` 2026-10-07 doğrulandı). Proxy her /app ve /admin
 * isteğinde (sayfa ve server action POST'u dahil) `auth.getClaims()` ile JWT'yi YEREL doğrular (JWKS imza + süre; ağ turu
 * yok) ve aktif profil / askıya alma / 2FA kapılarını çalıştırır. Bu kapıların hepsi geçtiğinde proxy isteğe
 * `AUTH_VERIFIED_HEADER = <user.id>` ekler; `getRequestUser` (auth-cache) bu başlık varsa yine `getClaims()`
 * (yerel doğrulama), yoksa `getUser()` (ağ doğrulaması) kullanır. Başlık:
 *   - her proxy isteğinde ÖNCE silinir (istemci sahteleyemez);
 *   - yalnız kapılar geçtikten sonra konur;
 *   - claims.sub ile birebir eşleşmeyen değer yok sayılır.
 * /api yolları proxy dışında: orada işaret hiç konmaz; sahte başlık en kötü ihtimalle oturumu kapatılmış ama süresi
 * dolmamış token'ı yerel doğrulamayla kabul ettirir — bu yollar `requirePermission` → tenant-guard ile ek DB kapılarından geçer.
 */
export const AUTH_VERIFIED_HEADER = "x-emlaksoft-auth-verified";

type Claims = Record<string, unknown> & { sub?: unknown };

/** Doğrulanmış claims → tüketicilerin kullandığı alanlarla User (id, app_metadata, user_metadata, email, phone). */
export function userFromClaims(claims: Claims): User | null {
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return {
    id: claims.sub,
    aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
    role: typeof claims.role === "string" ? claims.role : "authenticated",
    email: typeof claims.email === "string" ? claims.email : undefined,
    phone: typeof claims.phone === "string" ? claims.phone : undefined,
    app_metadata: (claims.app_metadata ?? {}) as User["app_metadata"],
    user_metadata: (claims.user_metadata ?? {}) as User["user_metadata"],
    is_anonymous: claims.is_anonymous === true,
    created_at: "",
  } as User;
}
