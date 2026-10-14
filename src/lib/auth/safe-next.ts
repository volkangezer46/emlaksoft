/**
 * TEK `next`/hedef yolu süzgeci (açık yönlendirme kapısı) — SAF; istemci + sunucu ortak, ağ/DB yok.
 *
 * Giriş, 2FA doğrulama/kurulum, Google callback ve giriş formunun gizli alanı bütün `next` değerlerini buradan geçirir.
 * Kabul: "/" ile başlayan uygulama içi göreli yol. Ret (→ fallback):
 *  - boş, 512 karakterden uzun, "/" ile başlamayan ya da "//" / "/\" ile başlayan (protokolsüz dış alan),
 *  - kontrol karakteri (\t \n \r, 0x00-0x1f, 0x7f) ya da ters bölü içeren (tarayıcılar "/\t/evil.com"u "//evil.com" sayar),
 *  - yüzde kodlu biçimi (%XX) çözülünce aynı kurallara takılan ("/%09/evil.com", "/%2F/evil.com", "/%5Cevil.com"),
 *  - başka origin'e çözülen ya da OAuth callback'in kendisine dönen.
 */

/** OAuth dönüş yolu (google-auth.ts `GOOGLE_CALLBACK_PATH` ile aynı); döngü olmasın diye hedef olamaz. */
const AUTH_CALLBACK_PATH = "/auth/callback";
const PROBE_ORIGIN = "http://emlaksoft.invalid";

function hasUnsafeChar(v: string): boolean {
  for (let i = 0; i < v.length; i += 1) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x5c) return true;
  }
  return false;
}

function isUnsafeShape(v: string): boolean {
  return !v.startsWith("/") || v.startsWith("//") || hasUnsafeChar(v);
}

export function safeNextPath(raw: string | null | undefined, fallback = "/app"): string {
  const v = typeof raw === "string" ? raw : "";
  if (!v || v.length > 512) return fallback;
  if (isUnsafeShape(v)) return fallback;
  // Yüzde kodlu kaçış: çözülmüş biçim de aynı kurallardan geçmeli. Bayt bayt çözülür (geçersiz dizi atlanır, fırlatmaz;
  // yalnız ASCII denetlendiği için çok baytlı UTF-8 karakterleri sonucu etkilemez).
  if (isUnsafeShape(v.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))))) return fallback;
  try {
    const u = new URL(v, PROBE_ORIGIN);
    if (u.origin !== PROBE_ORIGIN) return fallback;
    if (u.pathname === AUTH_CALLBACK_PATH || u.pathname.startsWith(`${AUTH_CALLBACK_PATH}/`)) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
