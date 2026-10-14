/**
 * Sunum geri bildirimi (YD2) — saf yardımcılar, TEK KAYNAK.
 *
 * Müşteri /sunum/[token] sayfasında her ilan için "İlgileniyorum / İlgilenmiyorum" + isteğe bağlı not bırakır
 * (`presentation_feedback`, 20261015042000). Yazan: `src/app/actions/presentation-feedback.ts` (token doğrulamalı,
 * service_role). Okuyanlar: müşteri kartı geçmişi (`customer-events.ts`), Sunumlar listesi ve public sayfanın
 * önceki seçimi göstermesi. İstemci bileşeni bu dosyayı içe aktarabilir (sunucu modülü yok).
 */

export const PRESENTATION_FEEDBACK_VERDICTS = ["interested", "not_interested"] as const;
export type PresentationFeedbackVerdict = (typeof PRESENTATION_FEEDBACK_VERDICTS)[number];

export const PRESENTATION_FEEDBACK_NOTE_MAX = 500;

/** Müşterinin gördüğü düğme etiketleri. */
export const PRESENTATION_FEEDBACK_LABEL: Record<PresentationFeedbackVerdict, string> = {
  interested: "İlgileniyorum",
  not_interested: "İlgilenmiyorum",
};

export function isPresentationFeedbackVerdict(v: unknown): v is PresentationFeedbackVerdict {
  return typeof v === "string" && (PRESENTATION_FEEDBACK_VERDICTS as readonly string[]).includes(v);
}

/**
 * Not: kontrol karakterleri atılır, satır sonu korunur (en çok 2 ardışık boş satır), kenar boşluğu kırpılır.
 * Boş not → null. Sınır aşımı burada KESİLMEZ (`noteTooLong` ile reddedilir; müşterinin metni sessizce kırpılmaz).
 */
export function normalizeFeedbackNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned ? cleaned : null;
}

export function noteTooLong(note: string | null): boolean {
  return (note?.length ?? 0) > PRESENTATION_FEEDBACK_NOTE_MAX;
}

/** Bildirim/zaman çizelgesi bağlantısı: bağlı müşteri varsa kartın geçmişi (portal kategorisi), yoksa Sunumlar. */
export function presentationFeedbackHref(customerId: string | null | undefined): string {
  return customerId ? `/app/musteriler/${customerId}?sekme=gecmis&kategori=portal` : "/app/portfoyler/sunumlar";
}

/**
 * Bildirim tekrar anahtarı: aynı ilan + aynı seçim için TR saat penceresinde tek bildirim. Müşteri (ya da linki alan
 * biri) İlgileniyorum ⇄ İlgilenmiyorum arasında gidip gelirse danışmana saatte ilan başına en çok iki zil düşer (hız
 * sınırının izin verdiği 30 değil); tablo yokken "aynı seçim" kontrolü çalışmasa da tekrar bastırılır. Kayıt her
 * değişiklikte güncellenir — pencere içindeki not değişikliği bildirimsiz kalır ama Müşteri 360 / Sunumlar'da görünür.
 * Saat anahtarı çağırandan gelir (saf kalsın; ör. `2026-10-14T21`, TR duvar saati).
 */
export function presentationFeedbackDedupeKey(
  presentationId: string,
  propertyId: string,
  verdict: PresentationFeedbackVerdict,
  hourKey: string,
): string {
  return `presentation-feedback:${presentationId}:${propertyId}:${verdict}:${hourKey}`;
}

/** Danışmana giden bildirim metni (zil + push). Not varsa tırnak içinde eklenir. */
export function presentationFeedbackNotification(input: {
  verdict: PresentationFeedbackVerdict;
  customerName: string | null;
  presentationTitle: string;
  propertyLabel: string;
  note: string | null;
}): { title: string; body: string; kind: "success" | "info" } {
  const who = input.customerName?.trim() || "Müşteriniz";
  const interested = input.verdict === "interested";
  const body = `${who}, "${input.presentationTitle}" sunumundaki ${input.propertyLabel} için "${PRESENTATION_FEEDBACK_LABEL[input.verdict]}" dedi.${
    input.note ? ` Not: "${input.note}"` : ""
  }`;
  return {
    title: interested ? "Müşteri sunumdaki bir portföyle ilgileniyor" : "Müşteri sunumdaki bir portföyle ilgilenmiyor",
    body,
    kind: interested ? "success" : "info",
  };
}

/** Sunum başına özet: ilgilenilen / ilgilenilmeyen ilan sayısı. */
export function summarizePresentationFeedback(
  rows: readonly { presentation_id: string; verdict: string }[],
): Map<string, { interested: number; notInterested: number }> {
  const map = new Map<string, { interested: number; notInterested: number }>();
  for (const r of rows) {
    const cur = map.get(r.presentation_id) ?? { interested: 0, notInterested: 0 };
    if (r.verdict === "interested") cur.interested += 1;
    else if (r.verdict === "not_interested") cur.notInterested += 1;
    map.set(r.presentation_id, cur);
  }
  return map;
}

/** "presentation_feedback tablosu yok" (migration uygulanmamış) hatası mı? PG 42P01 / PostgREST PGRST205. */
export function isMissingFeedbackTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("presentation_feedback") && (msg.includes("does not exist") || msg.includes("schema cache"));
}
