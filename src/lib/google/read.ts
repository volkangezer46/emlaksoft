import "server-only";
import { now } from "@/lib/clock";
import { secretsWritable } from "@/lib/settings/secrets";
import { platformSettingsPort } from "./db";
import { GOOGLE_KEYS } from "./keys";
import { openSealedJson, readGoogleSnapshot, type GoogleStoreSnapshot, type QuotaRecord } from "./token-store";
import { buildConnectionView, type ConnectionView } from "./view-model";

/**
 * Ekranların bağlantı okuyucusu (sunucu; YALNIZ platform_settings okunur, Google API çağrılmaz).
 * Okuma hatası "bağlı değil" görünümüne düşer ve `readError` işaretlenir (sayfa yine çizilir).
 */

const EMPTY: GoogleStoreSnapshot = { client: null, tokens: { gsc: null, ads: null }, adsAccount: null, gscProperty: null, problems: [] };

/**
 * `adsCustomerId: true` yalnız Google Ads panosu içindir (derin bağlantıların `__e` hesap parametresi). Varsayılan
 * görünüm maskeli kalır: bağlantı merkezi gibi görünümü bütünüyle istemciye geçen ekranlara açık kimlik gitmez.
 */
export async function readConnectionView(
  opts: { adsCustomerId?: boolean } = {},
): Promise<ConnectionView & { readError: boolean; adsCustomerId: string | null }> {
  const today = new Date(now()).toISOString().slice(0, 10);
  let snapshot = EMPTY;
  let quotas: { inspection: QuotaRecord | null; ads: QuotaRecord | null } = { inspection: null, ads: null };
  let readError = false;
  try {
    const [snap, raw] = await Promise.all([
      readGoogleSnapshot(platformSettingsPort),
      platformSettingsPort.read([GOOGLE_KEYS.quotaInspection, GOOGLE_KEYS.quotaAds]),
    ]);
    snapshot = snap;
    const open = (k: string) => {
      try {
        return openSealedJson<QuotaRecord>(k, raw[k]);
      } catch {
        return null;
      }
    };
    quotas = { inspection: open(GOOGLE_KEYS.quotaInspection), ads: open(GOOGLE_KEYS.quotaAds) };
  } catch {
    readError = true;
  }
  return {
    ...buildConnectionView({ snapshot, quotas, today, secretsEnabled: secretsWritable() }),
    readError,
    adsCustomerId: opts.adsCustomerId ? (snapshot.adsAccount?.customerId ?? null) : null,
  };
}
