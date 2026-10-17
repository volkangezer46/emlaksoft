import type { ZekaSurface } from "./types";

/**
 * Son sorgular deposunun anahtarı — AYRI ve bağımlılıksız: komut çubuğu (ana ekran / admin kontrol paneli ilk yükü) yalnız
 * bunu ister; fetch sarmalayıcısı ve depo okuma/yazma (`client.ts`) tembel Zeka paneliyle iner.
 * Anahtar kullanıcı kapsamlıdır (`zeka_recent:<yüzey>:<kapsam>`); kapsam yoksa kalıcı tutulmaz.
 */
export function recentKey(scope: string | undefined, surface: ZekaSurface): string | null {
  return scope ? `zeka_recent:${surface}:${scope}` : null;
}
