import { pendingReconsents } from "@/lib/legal-docs/core";
import { readReconsentDocs, readUserConsentState } from "@/lib/legal-docs/store";
import { LegalReconsentModal } from "./legal-reconsent-modal";

/**
 * /app kabuğunda yeniden onay kapısı (AD12). "Yeniden onay gerekli" olarak yayınlanmış bir yasal metin varsa ve
 * kullanıcı o sürümü (ya da yenisini) onaylamadıysa kapanmayan onay penceresi çıkar. HIZ: yeniden onay listesi
 * önbellekli (çoğu zaman boş → ek DB turu YOK); liste doluysa kullanıcının onayları tek turda okunur. Okuma hatası
 * kullanıcıyı kilitlemez (pencere çıkmaz, sonraki gezinmede yeniden denenir). Kabuktan ayrı Suspense sınırında akar.
 */
export async function LegalReconsentGate({ userId }: { userId: string }) {
  const docs = await readReconsentDocs();
  if (!docs.length) return null;
  let pending;
  try {
    const state = await readUserConsentState(userId, docs.map((d) => d.slug));
    pending = pendingReconsents(docs, state.consents, state.userCreatedAt);
  } catch {
    return null;
  }
  if (!pending.length) return null;
  return <LegalReconsentModal docs={pending.map((p) => ({ slug: p.slug, title: p.title, version: p.version }))} />;
}
