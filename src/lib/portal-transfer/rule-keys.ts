/**
 * Kural seti imzasını doğrulayan AÇIK anahtarlar ({kid: JWK}; ECDSA P-256). Eklenti paketine gömülür; sunucu GET ucu da
 * saklanan imzayı sunmadan önce bununla doğrular. ÖZEL anahtar yalnız ortamda durur (`PORTAL_RULES_SIGNING_KEY`,
 * `PORTAL_RULES_SIGNING_KID`), veritabanına ve depoya hiç girmez.
 *
 * BAŞLANGIÇTA BOŞ: sahip `npx tsx scripts/gen-portal-rules-keypair.ts` ile anahtar üretip açık JWK'yı buraya ekler.
 * Boşken sunucu 503 `signing_unavailable` döner, eklenti tüm uzak setleri reddeder ve TOHUMDA kalır (fail-safe).
 * Anahtar değişimi: yeni kid eklenir, eski kid bir sürüm daha tutulur, sonra çıkarılır.
 */
export const RULE_PUBLIC_KEYS: Readonly<Record<string, JsonWebKey>> = {};
