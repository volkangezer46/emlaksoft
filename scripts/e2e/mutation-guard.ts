/**
 * Oturumlu (mutasyonlu) E2E hedef kapısı (SK1/B178). Son oturumlu koşu canlıdaki `e2e-test` kiracısına yazmıştı:
 * mutasyon projesi YALNIZ izole/geçici bir Supabase'e karşı koşar. Kural (playwright.config.ts yüklenirken uygulanır):
 *   - E2E_MUTATION_ALLOWED=true değilse mutasyon projesi zaten kapalı (kapı bir şey yapmaz);
 *   - açıksa uygulama adresi (APP_URL) ya da APP_URL yoksa yerel sunucunun bağlanacağı Supabase
 *     (NEXT_PUBLIC_SUPABASE_URL) CANLI bir host ise koşu BAŞLAMAZ (hata fırlatılır).
 * Canlı hostlar: `E2E_PRODUCTION_HOSTS` (virgüllü) ya da varsayılan emlaksoft.com.tr ve tüm alt alanları.
 * Saf modül: hem playwright.config.ts hem vitest (scripts/e2e/mutation-guard.test.ts) içe aktarır.
 */

export const DEFAULT_PRODUCTION_HOSTS = ["emlaksoft.com.tr"] as const;

function hostOf(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    return new URL(v).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

export function productionHosts(env: Record<string, string | undefined>): string[] {
  const list = (env.E2E_PRODUCTION_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_PRODUCTION_HOSTS];
}

/** Host canlı listedeki bir alan adı ya da onun alt alanı mı. */
export function isProductionHost(host: string, hosts: readonly string[]): boolean {
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Mutasyonlu E2E bu ortamda başlayabilir mi; değilse nedeni. `enabled=false` → her zaman serbest (proje kapalı).
 * APP_URL varsa hedef odur; yoksa yerel `npm run dev` hangi Supabase'e yazacaksa o denetlenir. Adres çözülemezse
 * (boş/bozuk) RET: neye yazılacağı bilinmeyen koşu başlamaz.
 */
export function mutationE2EBlockReason(env: Record<string, string | undefined>): string | null {
  if (env.E2E_MUTATION_ALLOWED !== "true") return null;
  // DM1: genel demo ofisi (giriş kartları, slug demo-ofis) test kalıntısı ("[SAHA] ...") taşımaz; mutasyonlu koşu ve saha
  // test düzenekleri ayrı QA ofisini (E2E_TENANT_SLUG, ör. qa-ofis) hedefler.
  if (/@demo\.emlaksoft\.test$/i.test((env.E2E_USER_EMAIL ?? "").trim())) {
    return "E2E_USER_EMAIL demo kişiliği (genel demo ofisi); mutasyonlu koşu ayrı QA ofisinin kullanıcısıyla yapılır.";
  }
  if ((env.E2E_TENANT_SLUG ?? "").trim().toLowerCase() === "demo-ofis") {
    return "E2E_TENANT_SLUG=demo-ofis: genel demo ofisine test kaydı yazılmaz; QA ofisini hedefleyin.";
  }
  const hosts = productionHosts(env);
  const appHost = hostOf(env.APP_URL);
  if (env.APP_URL?.trim()) {
    if (!appHost) return `APP_URL çözülemedi (${env.APP_URL}); mutasyonlu E2E başlamaz.`;
    if (isProductionHost(appHost, hosts)) return `APP_URL canlı host (${appHost}); mutasyonlu E2E yalnız izole ortamda koşar.`;
    return null;
  }
  const dbHost = hostOf(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!dbHost) return "APP_URL yok ve NEXT_PUBLIC_SUPABASE_URL çözülemedi: yerel sunucunun yazacağı veritabanı bilinmiyor.";
  if (isProductionHost(dbHost, hosts)) return `Yerel sunucu canlı Supabase'e (${dbHost}) bağlı; mutasyonlu E2E yalnız izole Supabase'e karşı koşar.`;
  return null;
}

export function assertMutationE2ETarget(env: Record<string, string | undefined>): void {
  const reason = mutationE2EBlockReason(env);
  if (reason) throw new Error(`[e2e] ${reason}`);
}
