import { getModuleDef, isFeatureKey, type FeatureKey } from "@/lib/modules/registry";
import { isModuleEnabled } from "@/lib/modules/state";

/**
 * Server action modül kapısı (yetki kapısı `requirePermission` içinden TEK yerden çağrılır).
 *
 * Sayfa kapısı yetmez: UI gizlenmiş olsa da kapalı modülün formu doğrudan POST'lanabilir. Bu yüzden
 * YAZMA eylemleri (create/edit/delete) ofisin kapattığı modül için reddedilir. `view` eylemleri
 * engellenmez: veri sahipliği gereği dışa aktarım ve okuma açık kalır (tasarım: Modüller §4.5).
 *
 * Eşleme yalnız izin modülü ile ürün alanının BİRE BİR örtüştüğü durumlar içindir. Birden çok
 * ürün alanını kapsayan geniş izin modülleri (`settings`, `team`, `reports`, `targets`...) bilerek
 * dışarıdadır; onlar sayfa kapısı (`requireModulePage` + `featureForHref`) ile korunur.
 */
const PERMISSION_MODULE_FEATURE: Readonly<Record<string, FeatureKey>> = {
  portals: "portals",
  leak: "leak",
  campaigns: "campaigns",
  contracts: "contracts",
  offers: "offers",
  open_house: "open_house",
  rentals: "rentals",
  projects: "projects",
  network: "network",
  valuation: "valuation",
  expenses: "expenses",
  surveys: "surveys",
};

/** İzin modülünün bağlı olduğu kapatılabilir ürün alanı (yoksa çekirdek: null). */
export function featureForPermissionModule(mod: string): FeatureKey | null {
  return PERMISSION_MODULE_FEATURE[mod] ?? null;
}

/** Eylem kapatılmış modül yüzünden engellenmeli mi? (saf; yalnız yazma eylemleri) */
export function actionBlockedByModule(mod: string, action: string, closed: readonly string[]): FeatureKey | null {
  if (action === "view") return null;
  const key = featureForPermissionModule(mod);
  if (!key || !isFeatureKey(key)) return null;
  return closed.includes(key) ? key : null;
}

export function moduleClosedActionMessage(key: FeatureKey): string {
  return `${getModuleDef(key).label} modülü bu ofiste kapalı. Ofis sahibi Ayarlar > Modüller bölümünden yeniden açabilir.`;
}

/** Kapalı modülün yazma eylemi için hata metni; izinliyse null. İstek içinde önbelleklidir (`isModuleEnabled`). */
export async function moduleActionBlock(tenantId: string, mod: string, action: string): Promise<string | null> {
  if (action === "view") return null;
  const key = featureForPermissionModule(mod);
  if (!key) return null;
  if (await isModuleEnabled(tenantId, key)) return null;
  return moduleClosedActionMessage(key);
}
