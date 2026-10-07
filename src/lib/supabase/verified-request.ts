import type { User } from "@supabase/supabase-js";

/**
 * Proxy → sunucu bileşeni "bu istekte kimlik AĞ ile doğrulandı" işareti (SAF; hız turu 4, HAFIZA §30).
 *
 * Proje JWT'si asimetrik (ES256; `/auth/v1/.well-known/jwks.json` 2026-10-07 doğrulandı). Proxy her /app ve /admin
 * isteğinde (sayfa ve server action POST'u dahil) `auth.getUser()` ağ doğrulamasını + aktif profil / askıya alma / 2FA
 * kapılarını zaten çalıştırıyor. Bu kapıların hepsi geçtiğinde proxy isteğe `AUTH_VERIFIED_HEADER = <user.id>` ekler;
 * `getRequestUser` (auth-cache) bu başlık varsa ikinci ağ turu yerine `getClaims()` (JWKS ile yerel imza + süre
 * doğrulaması) kullanır. Başlık:
 *   - her proxy isteğinde ÖNCE silinir (istemci sahteleyemez);
 *   - yalnız JWT içeriği canlı kullanıcıyla aynıysa konur (app_metadata ve şifre değiştirme bayrağı); bayat token'da
 *     işaret yok → ağ doğrulaması (getUser) yapılır;
 *   - claims.sub ile birebir eşleşmeyen değer yok sayılır.
 * /api yolları proxy dışında: orada işaret hiç konmaz; sahte başlık en kötü ihtimalle oturumu kapatılmış ama süresi
 * dolmamış token'ı yerel doğrulamayla kabul ettirir — bu yollar `requirePermission` → tenant-guard ile ek DB kapılarından geçer.
 */
export const AUTH_VERIFIED_HEADER = "x-emlaksoft-auth-verified";

type Claims = Record<string, unknown> & { sub?: unknown };

function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
}

/** JWT içeriği canlı kullanıcıyla aynı mı (yetki/kimlik açısından anlamlı alanlar)? */
export function claimsMatchLiveUser(
  user: Pick<User, "id" | "app_metadata" | "user_metadata" | "email">,
  claims: Claims | null | undefined,
): boolean {
  if (!claims || claims.sub !== user.id) return false;
  const liveMeta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const tokenMeta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  if ((liveMeta.must_change_password === true) !== (tokenMeta.must_change_password === true)) return false;
  if ((user.email ?? null) !== ((claims.email as string | undefined) ?? null)) return false;
  return stable(user.app_metadata ?? {}) === stable(claims.app_metadata ?? {});
}

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
