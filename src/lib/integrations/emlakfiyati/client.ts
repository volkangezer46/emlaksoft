import "server-only";
import type { ValuationRequest, ValuationResponse } from "./contract";

/**
 * Emlakfiyati istemcisi — İSKELET, ETKİN DEĞİL.
 *
 * Sağlayıcının API belgesi ve ticari anlaşması gelmeden canlı çağrı kodu YAZILMAZ (ONERI Ö-6 başlama koşulu):
 * gerçek adres, kimlik doğrulama ve kota bilinmiyor; uydurma uç nokta sabitlenmez. Bu yüzden
 * `isEmlakfiyatiConfigured()` her zaman false, `fetchEmlakfiyatiEstimate()` her zaman null döner ve çağıran
 * (değerleme motoru) kaynağı Endeksa deseniyle sessizce atlar — hiçbir davranış değişmez.
 *
 * Belge gelince burada yapılacaklar: izinli host listesi (`integrations/provider-url.ts`), `external-fetch.ts` ile
 * zaman aşımı/boyut sınırı, kimlik bilgisi okuma, kota sayacı, `parseValuationResponse` ile doğrulama,
 * `requirePermission("valuation","create")` ve `valuation` modülü açıklığı (çağıran tarafta).
 */
export async function isEmlakfiyatiConfigured(): Promise<boolean> {
  return false;
}

export async function fetchEmlakfiyatiEstimate(_request: ValuationRequest): Promise<ValuationResponse | null> {
  void _request;
  return null;
}
