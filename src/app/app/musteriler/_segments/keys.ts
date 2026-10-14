/**
 * Müşteriler listesinin eylem süzgeçleri (`?segment=`; SAF, istemci/sunucu ortak). Sıcaklık süzgeçleri
 * (`HEAT_SEGMENT_KEYS`: sicak · ilgili · soguk · uykuda) ile aynı parametreyi paylaşır; adlar çakışmaz.
 */
export const ACTION_SEGMENT_KEYS = ["risk", "satici"] as const;
export type ActionSegment = (typeof ACTION_SEGMENT_KEYS)[number];

export const ACTION_SEGMENTS: Record<ActionSegment, { label: string; title: string; sub: string; emptyHint: string }> = {
  risk: {
    label: "Kaybedilme riski",
    title: "Kaybedilme riski yüksek",
    sub: "Değerli ama sessizleşen müşteriler; bugün arayın. Aranan ya da ertelenen müşteri bir süre listeden düşer.",
    emptyHint: "Sessizleşen değerli müşteriniz yok; düzenli temas sürüyor.",
  },
  satici: {
    label: "Satışa çıkabilir",
    title: "Satışa çıkarabilir malikler",
    sub: "Listeleme olasılığı yüksek mülk sahipleri; portföy isteyin.",
    emptyHint: "Mülk sahibi tipinde ve listeleme sinyali veren müşteri yok; müşteri tipini 'Mülk sahibi' işaretlemeyi unutmayın.",
  },
};

export function parseActionSegment(raw: string | undefined): ActionSegment | null {
  return (ACTION_SEGMENT_KEYS as readonly string[]).includes(raw ?? "") ? (raw as ActionSegment) : null;
}

export function actionSegmentHref(segment: ActionSegment): string {
  return `/app/musteriler?segment=${segment}`;
}
