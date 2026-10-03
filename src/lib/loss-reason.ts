/**
 * Anlaşma kayıp nedeni — saf yardımcılar (client/server ortak, bağımlılıksız).
 *
 * Kaynak liste: `definitions` kategorisi `loss_reason` (varsayılanlar definition-defaults.ts).
 * Saklama (deals.loss_reason, text — migration/enum yok, geriye uyumlu):
 *   "<value>"            seçim, not yok
 *   "<value> | <not>"    seçim + not  ("diger" için not zorunlu)
 *   "<serbest metin>"    ESKİ kayıtlar; olduğu gibi görünür ve kendi adıyla gruplanır
 */
import { defaultLabelMap } from "@/lib/definition-defaults";

export const LOSS_REASON_OTHER = "diger";
export const LOSS_NOTE_SEPARATOR = " | ";
export const LOSS_NOTE_MAX = 300;
export const LOSS_REASON_UNSPECIFIED = "Belirtilmemiş";

type LabelSource = { value: string; label: string }[];

/** Varsayılan + ofis tanımı etiket haritası (gizlenmiş/silinmiş eski değerler de okunur kalsın). */
export function lossReasonLabels(options: LabelSource): Record<string, string> {
  return { ...defaultLabelMap("loss_reason"), ...Object.fromEntries(options.map((o) => [o.value, o.label])) };
}

export type LossReasonCheck = { ok: true; stored: string } | { ok: false; error: string };

/** Seçim zorunlu; seçilen değer aktif listede olmalı; "diger" için not zorunlu. */
export function validateLossReason(value: string, note: string, options: LabelSource): LossReasonCheck {
  const v = value.trim();
  const n = note.trim();
  if (!v) return { ok: false, error: "Kayıp nedeni seçmelisiniz." };
  if (!options.some((o) => o.value === v)) return { ok: false, error: "Geçersiz kayıp nedeni." };
  if (v === LOSS_REASON_OTHER && !n) return { ok: false, error: "“Diğer” seçildiğinde açıklama notu zorunludur." };
  if (n.length > LOSS_NOTE_MAX) return { ok: false, error: `Not en fazla ${LOSS_NOTE_MAX} karakter olabilir.` };
  return { ok: true, stored: n ? `${v}${LOSS_NOTE_SEPARATOR}${n.replace(/\s+/g, " ")}` : v };
}

export type ParsedLossReason = {
  /** Tanım değeri; eski serbest metinde null. */
  value: string | null;
  label: string;
  note: string | null;
  legacy: boolean;
};

export function parseLossReason(stored: string | null | undefined, labels: Record<string, string>): ParsedLossReason {
  const raw = (stored ?? "").trim();
  if (!raw) return { value: null, label: LOSS_REASON_UNSPECIFIED, note: null, legacy: false };
  if (Object.hasOwn(labels, raw)) return { value: raw, label: labels[raw], note: null, legacy: false };
  const idx = raw.indexOf(LOSS_NOTE_SEPARATOR);
  if (idx > 0) {
    const head = raw.slice(0, idx);
    if (Object.hasOwn(labels, head)) {
      const note = raw.slice(idx + LOSS_NOTE_SEPARATOR.length).trim();
      return { value: head, label: labels[head], note: note || null, legacy: false };
    }
  }
  return { value: null, label: raw, note: null, legacy: true };
}

/** Rapor gruplama etiketi: değer → tanım adı (ad değişse de tek grup); eski serbest metin → kendisi. */
export function lossReasonGroupLabel(stored: string | null | undefined, labels: Record<string, string>): string {
  return parseLossReason(stored, labels).label;
}

/** Görünüm metni: "Etiket" veya "Etiket — not". */
export function formatLossReason(stored: string | null | undefined, labels: Record<string, string>): string {
  const p = parseLossReason(stored, labels);
  return p.note ? `${p.label} — ${p.note}` : p.label;
}
