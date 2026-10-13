import "server-only";
import { unstable_cache } from "next/cache";
import { pendingReconsents, type PendingReconsent, type ReconsentDocRow } from "./core";
import { LEGAL_DOCS_TAG, readUserConsentState } from "./store";

/**
 * Kullanıcının bekleyen yeniden onayları — KULLANICIYA ÖZEL önbellek (HIZ, AD12). Bir belge "yeniden onay gerekli" ile
 * yayınlandıktan sonra yeniden onay listesi kalıcı olarak dolu kalır; önbelleksiz her /app gezinmesi iki service_role
 * sorgusu (legal_consents + profiles) çalıştırırdı. Anahtar: userId + gerekli sürüm imzası (yeni yayın → yeni anahtar,
 * eski sonuç kullanılmaz). Onay yazımı kullanıcı etiketini tazeler (`acceptLegalUpdates`). Okuma hatası fırlatılır ve
 * ÖNBELLEĞE GİRMEZ (çağıran kullanıcıyı kilitlemez).
 */
export const legalConsentUserTag = (userId: string) => `legal-consent:${userId}`;

export async function readPendingReconsentsCached(userId: string, docs: readonly ReconsentDocRow[]): Promise<PendingReconsent[]> {
  const sig = docs
    .map((d) => `${d.slug}:${d.version}:${d.requiredVersion}`)
    .sort()
    .join(",");
  return unstable_cache(
    async (): Promise<PendingReconsent[]> => {
      const state = await readUserConsentState(userId, docs.map((d) => d.slug));
      return pendingReconsents(docs, state.consents, state.userCreatedAt);
    },
    ["legal-pending-reconsent-v1", userId, sig],
    { revalidate: 3600, tags: [legalConsentUserTag(userId), LEGAL_DOCS_TAG] },
  )();
}
