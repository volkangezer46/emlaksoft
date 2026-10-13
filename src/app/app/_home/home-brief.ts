/**
 * Ana ekran brifing mantığı — SAF (React/DB yok; vitest kapsamında).
 *
 * - `pickBriefing`: içgörü varsa odak + kompakt satırlar; yoksa kural tabanlı geri dönüş ("sıradaki eylem").
 *   Sahte içgörü ÜRETİLMEZ: okuyucu boş dönerse (tablo yok, örnek veri, yeni ofis) mod "fallback" olur.
 * - `buildCallRows`: "Bugün ara" satırları NEDENLİ (skor yerine gerekçe): call_priority içgörüsü kanıtları
 *   + lead-skoru bileşenleri.
 * - `scheduleWarnings`: bugünün programında sıkışık ardışık randevu uyarısı (yalnız gerçek saatlerden).
 */
import type { Insight, InsightSeverity } from "@/lib/insights/types";
import { formatDateTr } from "@/lib/format";

export type BriefingMode = "insight" | "fallback";

export type Briefing = {
  mode: BriefingMode;
  focus: Insight | null;
  /** Odağın altındaki numaralı kompakt satırlar (en çok `maxRows`). */
  rows: Insight[];
  /** Okunabilir içgörü toplamı ("Tüm içgörüler (n)"). */
  total: number;
};

export const BRIEFING_MAX_ROWS = 4;

const SEVERITY_ORDER: Record<InsightSeverity, number> = { yuksek: 0, orta: 1, bilgi: 2 };

/** Önceliğe (yoksa şiddete) göre azalan; eşitlikte okuyucunun sırası korunur (kararlı sıralama). */
export function sortInsights(list: readonly Insight[]): Insight[] {
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => b.x.priority - a.x.priority || SEVERITY_ORDER[a.x.severity] - SEVERITY_ORDER[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}

export function pickBriefing(insights: readonly Insight[], totalCount?: number, maxRows = BRIEFING_MAX_ROWS): Briefing {
  // "digest" özet kartı odak olamaz (kendi başına eylem değildir); yine de listede kalır.
  const ordered = sortInsights(insights);
  if (ordered.length === 0) return { mode: "fallback", focus: null, rows: [], total: 0 };
  const focusIdx = Math.max(0, ordered.findIndex((i) => i.kind !== "digest"));
  const focus = ordered[focusIdx]!;
  const rows = ordered.filter((_, i) => i !== focusIdx).slice(0, Math.max(0, Math.min(maxRows, 4)));
  return { mode: "insight", focus, rows, total: Math.max(totalCount ?? ordered.length, ordered.length) };
}

export const SEVERITY_LABEL: Record<InsightSeverity, string> = { yuksek: "Yüksek önem", orta: "Orta önem", bilgi: "Bilgi" };
export const SEVERITY_TONE: Record<InsightSeverity, "danger" | "warn" | "brand"> = {
  yuksek: "danger",
  orta: "warn",
  bilgi: "brand",
};

/** Değerin başındaki ISO tarih/zaman ("2026-09-29", "2026-09-29T10:00:00Z"). */
const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/;
const CHIP_DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

/** ISO ile başlayan kanıt değerini Türkçe tarihe çevirir ("2026-09-29" → "29 Eyl 2026"); çözülemezse aynen kalır. */
export function humanizeEvidenceValue(value: string): string {
  const m = ISO_PREFIX.exec(value);
  if (!m) return value;
  const d = new Date(m[0].length === 10 ? `${m[0]}T12:00:00Z` : m[0]);
  if (Number.isNaN(d.getTime())) return value;
  return formatDateTr(d, CHIP_DATE) + value.slice(m[0].length);
}

/**
 * Kullanıcıya gösterilecek kanıtlar: boş etiket/değer ve iç sıralama notu ("Sıra", motorun öncelik açıklaması)
 * elenir, ISO tarih değerleri "29 Eyl 2026" biçimine çevrilir.
 */
function visibleEvidence(evidence: Insight["evidence"]): Insight["evidence"] {
  return evidence
    .filter((e) => e.label.trim() && e.value.trim() && e.label.trim() !== "Sıra")
    .map((e) => ({ ...e, value: humanizeEvidenceValue(e.value) }));
}

/** Odak kartının "neden" etiketleri: kanıt satırları "etiket: değer" (en çok `max`). */
export function evidenceChips(insight: Pick<Insight, "evidence">, max = 4): { label: string; value: string; href?: string }[] {
  return visibleEvidence(insight.evidence).slice(0, max);
}

/* --------------------------------- Bugün ara -------------------------------- */

export type CallLeadInput = { id: string; fullName: string; phone: string | null; reasons: string[] };
export type CallRow = {
  key: string;
  customerId: string | null;
  name: string;
  phone: string | null;
  reasons: string[];
  href: string;
  source: "insight" | "lead";
};

export function buildCallRows(leads: readonly CallLeadInput[], insights: readonly Insight[], max = 6): CallRow[] {
  const byCustomer = new Map(leads.map((l) => [l.id, l]));
  const used = new Set<string>();
  const rows: CallRow[] = [];
  for (const ins of sortInsights(insights)) {
    if (ins.kind !== "call_priority") continue;
    const cid = ins.entityType === "customer" ? ins.entityId : null;
    const lead = cid ? byCustomer.get(cid) : undefined;
    if (cid) used.add(cid);
    const reasons = visibleEvidence(ins.evidence).map((e) => `${e.label}: ${e.value}`).slice(0, 3);
    rows.push({
      key: `i-${ins.id}`,
      customerId: cid,
      name: lead?.fullName ?? ins.title.replace(/ ile görüş$/, ""),
      phone: lead?.phone ?? null,
      reasons: reasons.length ? reasons : [ins.why],
      href: ins.href,
      source: "insight",
    });
  }
  for (const l of leads) {
    if (used.has(l.id)) continue;
    rows.push({
      key: `l-${l.id}`,
      customerId: l.id,
      name: l.fullName,
      phone: l.phone,
      reasons: l.reasons.length ? l.reasons : ["Sıcak müşteri"],
      href: `/app/musteriler/${l.id}`,
      source: "lead",
    });
  }
  return rows.slice(0, Math.max(0, max));
}

/* ------------------------------ Bugünün programı ----------------------------- */

export const TIGHT_GAP_MIN = 45;

export type ScheduleWarning = { fromIndex: number; toIndex: number; gapMin: number };

/** Ardışık iki randevu arası `tightMin` dakikadan azsa uyarı (zamanlar epoch ms, sıralı ya da sırasız). */
export function scheduleWarnings(timesMs: readonly number[], tightMin = TIGHT_GAP_MIN): ScheduleWarning[] {
  const sorted = timesMs.map((t, i) => ({ t, i })).filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
  const out: ScheduleWarning[] = [];
  for (let k = 1; k < sorted.length; k++) {
    const gapMin = Math.round((sorted[k]!.t - sorted[k - 1]!.t) / 60_000);
    if (gapMin < tightMin) out.push({ fromIndex: sorted[k - 1]!.i, toIndex: sorted[k]!.i, gapMin });
  }
  return out;
}

export function scheduleWarningText(w: ScheduleWarning): string {
  return w.gapMin <= 0 ? "Aynı saatte iki randevu var" : `İki randevu arası yalnız ${w.gapMin} dk — yol süresini hesaba katın`;
}
