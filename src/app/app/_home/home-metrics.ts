/**
 * Ana ekran metrik/huni/hedef/ekip saf hesapları (React/DB yok; vitest kapsamında).
 * Kural: bağlamı (karşılaştırma, hedef, seri) olmayan sayı çizilmez — burada her hesap bağlamı ile döner.
 */
import { computeTrend, hasSeries, type Trend } from "@/components/ui/premium/premium-math";
import { DAY_MS, TR_OFFSET_MS, trParts } from "@/lib/clock";

export type MetricTone = "brand" | "success" | "warn" | "danger" | "gold" | "neutral";

export type MetricSpec = {
  key: string;
  label: string;
  /** Sayısal değer (CountUp için) — para ise `format: "money"`. */
  value: number;
  format: "number" | "money" | "percent";
  /** Değerin sonuna eklenen birim (" dk" gibi). */
  suffix?: string;
  tone: MetricTone;
  href: string;
  /** Önceki döneme fark (varsa). */
  trend: Trend | null;
  /** Karşılaştırma cümlesi ("Önceki 30 gün 12"); trend yoksa yine bağlam metni verilir. */
  context: string;
  /** Gerçek seri (>=2 nokta) yoksa null → çizim yok. */
  series: number[] | null;
  seriesLabel: string;
};

/** Karşılaştırmalı metrik: önceki dönem verilince trend + cümle üretir. */
export function comparedMetric(args: {
  key: string;
  label: string;
  value: number;
  previous: number;
  previousText: string;
  format?: MetricSpec["format"];
  tone?: MetricTone;
  href: string;
  series?: readonly number[] | null;
  seriesLabel: string;
  invert?: boolean;
}): MetricSpec {
  return {
    key: args.key,
    label: args.label,
    value: args.value,
    format: args.format ?? "number",
    tone: args.tone ?? "brand",
    href: args.href,
    trend: computeTrend(args.value, args.previous, args.invert),
    context: args.previousText,
    series: hasSeries(args.series) ? [...(args.series as readonly number[])] : null,
    seriesLabel: args.seriesLabel,
  };
}

/** Karşılaştırması olmayan ama bağlam cümlesi/serisi olan metrik (ör. oran + yanında eksik sayısı). */
export function contextMetric(args: {
  key: string;
  label: string;
  value: number;
  context: string;
  suffix?: string;
  format?: MetricSpec["format"];
  tone?: MetricTone;
  href: string;
  series?: readonly number[] | null;
  seriesLabel: string;
}): MetricSpec {
  return {
    key: args.key,
    label: args.label,
    value: args.value,
    format: args.format ?? "number",
    ...(args.suffix ? { suffix: args.suffix } : {}),
    tone: args.tone ?? "brand",
    href: args.href,
    trend: null,
    context: args.context,
    series: hasSeries(args.series) ? [...(args.series as readonly number[])] : null,
    seriesLabel: args.seriesLabel,
  };
}

/** Bağlamsız metrik gösterilmez: trend, bağlam cümlesi ya da seriden en az biri olmalı. */
export function hasContext(m: Pick<MetricSpec, "trend" | "context" | "series">): boolean {
  return Boolean(m.trend) || m.context.trim().length > 0 || Boolean(m.series);
}

/** Aynı anahtar ekranda iki kez çizilmez (ilk kazanır). */
export function dedupeMetrics<T extends { key: string }>(list: readonly T[]): T[] {
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)));
}

/* --------------------------- Karar bekleyenler ---------------------------- */

export type DecisionItem = { key: string; value: number; label: string; hint: string; href: string; tone: "danger" | "warn" | "brand" };

/**
 * Karar kalemlerini tek yerde kurar. Yalnız GERÇEK sayı > 0 olan kalem girer.
 * Sıra: onay → geciken tahsilat → hareketsiz danışman → yetkisi dolan portföy.
 * (Kaçan komisyon burada DEĞİL: "Kaçan komisyon/risk" bloğundadır — aynı sayı iki yerde yok.)
 */
export function buildDecisionItems(d: {
  approvals: number | null;
  overdueRent: number | null;
  passiveAdvisors: number | null;
  passiveDays: number;
  expiringAuthority: number;
}): DecisionItem[] {
  const items: DecisionItem[] = [];
  if (d.approvals) {
    items.push({ key: "onay", value: d.approvals, label: "Onay bekleyen talep", hint: "Senin kararını bekliyor", href: "/app/onaylar?kim=bana", tone: "warn" });
  }
  if (d.overdueRent) {
    items.push({ key: "tahsilat", value: d.overdueRent, label: "Geciken tahsilat", hint: "Gecikmiş kira tahakkuku", href: "/app/kiralama?durum=overdue", tone: "danger" });
  }
  if (d.passiveAdvisors) {
    items.push({
      key: "pasif",
      value: d.passiveAdvisors,
      label: "Hareketsiz danışman",
      hint: `${d.passiveDays} gündür anlaşma hareketi yok`,
      href: "/app/ekip",
      tone: "brand",
    });
  }
  if (d.expiringAuthority) {
    items.push({ key: "yetki", value: d.expiringAuthority, label: "Yetkisi dolan portföy", hint: "15 gün içinde bitiyor", href: "/app/portfoyler", tone: "warn" });
  }
  return items;
}

/** Tahsilat oranı: tahsil / tahakkuk (6 ay). Tahakkuk 0 ise null (oran uydurulmaz). */
export function collectionRatePct(paid: number, accrued: number): number | null {
  return accrued > 0 ? Math.round((paid / accrued) * 100) : null;
}

/* ---------------------------------- Ay ------------------------------------ */

/** Türkiye takvimine göre içinde bulunulan ayın ilerlemesi ve kalan gün (bugün dahil, en az 1). */
export function monthProgress(nowMs: number): { elapsedPct: number; daysLeft: number } {
  const p = trParts(nowMs);
  const start = Date.UTC(p.year, p.month, 1) - TR_OFFSET_MS;
  const end = Date.UTC(p.year, p.month + 1, 1) - TR_OFFSET_MS;
  const elapsedPct = Math.max(0, Math.min(100, Math.round(((nowMs - start) / (end - start)) * 100)));
  return { elapsedPct, daysLeft: Math.max(1, Math.ceil((end - nowMs) / DAY_MS)) };
}

/* --------------------------------- Hedef ---------------------------------- */

export type TargetPace = {
  /** Gerçekleşme (%), sınırsız (aşım >100 görünür). */
  pct: number;
  /** Ay ilerlemesine göre beklenen (%). */
  expectedPct: number;
  state: "exceeded" | "behind" | "on-track";
  /** Hedefe ulaşmak için kalan günde gereken günlük hız (hedef birimi/gün); aşılmışsa 0. */
  requiredPerDay: number;
  remaining: number;
  daysLeft: number;
};

/** `daysLeft` en az 1 sayılır (bugün dahil). Tolerans 10 puan (/app/hedefler ile aynı). */
export function targetPace(args: { actual: number; target: number; elapsedPct: number; daysLeft: number }): TargetPace | null {
  const { actual, target } = args;
  if (!(target > 0) || !Number.isFinite(actual)) return null;
  const pct = Math.round((actual / target) * 100);
  const expectedPct = Math.max(0, Math.min(100, Math.round(args.elapsedPct)));
  const remaining = Math.max(0, target - actual);
  const daysLeft = Math.max(1, Math.floor(args.daysLeft));
  const state: TargetPace["state"] = pct >= 100 ? "exceeded" : args.elapsedPct < 100 && pct < expectedPct - 10 ? "behind" : "on-track";
  return { pct, expectedPct, state, remaining, daysLeft, requiredPerDay: remaining / daysLeft };
}

/* ---------------------------------- Huni ---------------------------------- */

export type FunnelInput = { newDemand: number; activeDemand: number; matchedDemand: number; won: number };
export type FunnelRow = { label: string; value: number; href: string; sub: string };

/**
 * Huni aşamaları. Talep durumları ve kazanılan anlaşma BAĞIMSIZ sayımlardır (her biri bir öncekinin alt kümesi
 * değildir), bu yüzden dönüşüm oku ÇİZİLMEZ (`FUNNEL_SEQUENTIAL = false`); yerine aşama payı ("en büyük aşamanın %x'i")
 * yazılır. Gerçek ardışık (kohort) huni verisi gelince yalnız bu sabit ve veri kaynağı değişir.
 */
export const FUNNEL_SEQUENTIAL = false;

export function funnelRows(i: FunnelInput): FunnelRow[] {
  const stages = [
    { label: "Yeni talep", value: i.newDemand, href: "/app/talepler?status=new" },
    { label: "Aktif talep", value: i.activeDemand, href: "/app/talepler?status=active" },
    { label: "Eşleşen", value: i.matchedDemand, href: "/app/talepler?status=matched" },
    { label: "Kazanılan anlaşma", value: i.won, href: "/app/anlasmalar" },
  ];
  const max = Math.max(0, ...stages.map((s) => s.value));
  return stages.map((s) => ({
    ...s,
    sub: max > 0 && s.value !== max ? `En büyük aşamanın %${Math.round((s.value / max) * 100)}'i` : max > 0 ? "En büyük aşama" : "",
  }));
}

/* ----------------------------------- Ekip ---------------------------------- */

export type TeamRowInput = {
  id: string;
  fullName: string;
  callCount: number;
  appointCount: number;
  offerCount: number;
  dealCount: number;
  targetPct: number | null;
};
export type TeamStatus = "ok" | "warn" | "danger" | "none";

export function teamStatus(targetPct: number | null, elapsedPct: number): TeamStatus {
  if (targetPct === null) return "none";
  if (targetPct >= 100 || targetPct >= elapsedPct - 10) return "ok";
  return targetPct >= (elapsedPct - 10) / 2 ? "warn" : "danger";
}

export const TEAM_STATUS_LABEL: Record<TeamStatus, string> = {
  ok: "Tempo yolunda",
  warn: "Tempo geride",
  danger: "Tempo çok geride",
  none: "Hedef tanımsız",
};

/** Anlaşma, sonra teklif, sonra görüşme sayısına göre azalan; en çok `max` satır. */
export function rankTeam<T extends TeamRowInput>(rows: readonly T[], max = 8): T[] {
  return [...rows]
    .sort((a, b) => b.dealCount - a.dealCount || b.offerCount - a.offerCount || b.callCount - a.callCount || a.fullName.localeCompare(b.fullName, "tr"))
    .slice(0, max);
}
