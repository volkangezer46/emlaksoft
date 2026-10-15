/**
 * Açık ev "toplu dönüştür" yardımcıları (SAF; istemci + sunucu).
 * Sunucu eylemi (`convertAllVisitors`) her ziyaretçi için atomik dönüştürme RPC'sini çağırır;
 * buradaki fonksiyonlar RPC sonuçlarını sayaçlara çevirir ve teşekkür taslağını kurar.
 */

export type BulkConvertCounts = { created: number; linked: number; skipped: number; failed: number };

/** RPC'nin döndürdüğü sonuç (veya hata halinde `null`). */
export type ConvertRpcOutcome = { outcome?: string | null; customer_id?: string | null } | null;

export const EMPTY_BULK_COUNTS: BulkConvertCounts = { created: 0, linked: 0, skipped: 0, failed: 0 };

/**
 * Tek bir RPC sonucunu kovaya ayırır:
 *  - created / linked → müşteri bu çalıştırmada açıldı / mevcut müşteriye bağlandı
 *  - replay → ziyaretçi zaten dönüştürülmüş (idempotent tekrar) → skipped
 *  - invalid_visitor / not_found → dönüştürülemeyecek kayıt → skipped
 *  - hata, bilinmeyen sonuç ya da customer_id'siz başarı → failed
 */
export function classifyConvertOutcome(result: ConvertRpcOutcome): keyof BulkConvertCounts {
  if (!result) return "failed";
  const outcome = result.outcome ?? "";
  if (outcome === "created" || outcome === "linked") return result.customer_id ? outcome : "failed";
  if (outcome === "replay" || outcome === "invalid_visitor" || outcome === "not_found") return "skipped";
  return "failed";
}

/** Sonuç listesini {created, linked, skipped, failed} sayaçlarına toplar. */
export function aggregateConvertOutcomes(results: readonly ConvertRpcOutcome[]): BulkConvertCounts {
  const counts = { ...EMPTY_BULK_COUNTS };
  for (const r of results) counts[classifyConvertOutcome(r)] += 1;
  return counts;
}

/** Kullanıcıya gösterilecek kısa özet (sıfır olan kovalar yazılmaz). */
export function formatBulkConvertSummary(c: BulkConvertCounts): string {
  const parts: string[] = [];
  if (c.created) parts.push(`${c.created} yeni müşteri`);
  if (c.linked) parts.push(`${c.linked} mevcut müşteriye bağlandı`);
  if (c.skipped) parts.push(`${c.skipped} atlandı`);
  if (c.failed) parts.push(`${c.failed} başarısız`);
  return parts.length ? parts.join(", ") : "Dönüştürülecek ziyaretçi yok";
}

/** D+1 teşekkür görevlerini tekrar açmamak için başlıktaki işaret. */
export const OPEN_HOUSE_THANKS_MARK = "Açık ev teşekkür + geri bildirim";

/** Ziyaretçiye WhatsApp'tan gönderilecek teşekkür taslağı (kullanıcı kendisi gönderir). */
export function openHouseThankYouMessage(fullName: string | null | undefined, propertyLabel: string | null | undefined): string {
  const firstName = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  const hello = firstName ? `Merhaba ${firstName},` : "Merhaba,";
  const about = propertyLabel?.trim() ? `${propertyLabel.trim()} için düzenlediğimiz` : "düzenlediğimiz";
  return `${hello} ${about} açık eve katıldığınız için teşekkür ederiz. Mülk hakkındaki görüşlerinizi ve sorularınızı paylaşırsanız memnun oluruz.`;
}
