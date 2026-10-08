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

/* --------------------------- Dikkat gerektirenler --------------------------- */

/** Önem düzeyi (AttentionList ile aynı dört düzey; renk tek başına anlam taşımaz). */
export type AttentionLevelKey = "acil" | "yuksek" | "orta" | "dusuk";

export type HomeAttentionItem = {
  id: string;
  label: string;
  hint: string;
  href: string;
  level: AttentionLevelKey;
  /** Gerçek sayı; tavanlı/tutar kalemlerde verilmez (yanlış sayı gösterilmez). */
  count?: number;
  /** Hero cümlesi ve opsiyonel AI özeti için kısa metin ("3 gecikmiş görev"). */
  brief: string;
};

/**
 * Girdiler: her alan GERÇEK sayım; `null` = okunamadı ya da bu rol/izin görmez (kalem çizilmez, sahte sıfır yok).
 * `mine` kapsamı hedef bağlantılara taşınır (ana ekran "Ben" görünümündeyse liste de kişiye süzülür).
 */
export type AttentionInput = {
  overdueTasks: number | null;
  approvals: number | null;
  overdueRent: number | null;
  staleDeals: number | null;
  staleDays: number;
  /** Tahsil edilmemiş komisyon tutarı (₺); tutar olduğu için `count` taşımaz. */
  pendingCommission: number | null;
  pendingCommissionText: string;
  passiveAdvisors: number | null;
  passiveDays: number;
  mine: boolean;
  userId: string;
};

const LEVEL_ORDER: Record<AttentionLevelKey, number> = { acil: 0, yuksek: 1, orta: 2, dusuk: 3 };

/**
 * "Dikkat gerektirenler" kalemlerini tek yerde kurar (eski "Karar bekleyenler" + "Bugün kuyruğu" birleşti).
 * Yalnız sayısı > 0 olan kalem girer; sıra önem düzeyi, eşitlikte tanım sırası. Her kalem filtrelenmiş listeye gider.
 * (İlan olguları — teyitsiz ilan, yetkisi dolan, kayıp/kapanmış — burada DEĞİL: tek "İlan sağlığı" bloğundadır; aynı sayı iki yerde yok.)
 */
export function buildAttentionItems(d: AttentionInput): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];
  const mineTask = d.mine ? "&mine=1" : "";
  const mineOwner = d.mine ? `&danisman=${d.userId}` : "";
  if (d.overdueRent) {
    items.push({
      id: "tahsilat",
      label: "Geciken kira tahsilatı",
      hint: "Vadesi geçmiş kira tahakkuku",
      href: "/app/kiralama?durum=overdue",
      level: "acil",
      count: d.overdueRent,
      brief: `${d.overdueRent} geciken kira tahsilatı`,
    });
  }
  if (d.overdueTasks) {
    items.push({
      id: "gorev",
      label: "Geciken görev",
      hint: "Vadesi geçmiş açık görev",
      href: `/app/gorevler?filter=overdue${mineTask}`,
      level: "acil",
      count: d.overdueTasks,
      brief: `${d.overdueTasks} gecikmiş görev`,
    });
  }
  if (d.approvals) {
    items.push({
      id: "onay",
      label: "Onay bekleyen talep",
      hint: "Senin kararını bekliyor",
      href: "/app/onaylar?kim=bana",
      level: "yuksek",
      count: d.approvals,
      brief: `${d.approvals} onay bekleyen talep`,
    });
  }
  if (d.staleDeals) {
    items.push({
      id: "riskli-anlasma",
      label: "Riskli anlaşma",
      hint: `${d.staleDays}+ gündür hareketsiz açık anlaşma`,
      href: `/app/anlasmalar?bayat=1${mineOwner}`,
      level: "yuksek",
      count: d.staleDeals,
      brief: `${d.staleDeals} anlaşma ${d.staleDays}+ gündür hareketsiz`,
    });
  }
  if (d.pendingCommission && d.pendingCommission > 0) {
    items.push({
      id: "komisyon",
      label: "Bekleyen komisyon",
      hint: `${d.pendingCommissionText} tahsil/onay bekliyor`,
      href: "/app/komisyon?durum=bekleyen",
      level: "orta",
      brief: `${d.pendingCommissionText} komisyon tahsil bekliyor`,
    });
  }
  if (d.passiveAdvisors) {
    items.push({
      id: "pasif",
      label: "Hareketsiz danışman",
      hint: `${d.passiveDays} gündür anlaşma hareketi yok`,
      href: "/app/ekip",
      level: "dusuk",
      count: d.passiveAdvisors,
      brief: `${d.passiveAdvisors} danışman ${d.passiveDays} gündür hareketsiz`,
    });
  }
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => LEVEL_ORDER[a.it.level] - LEVEL_ORDER[b.it.level] || a.i - b.i)
    .map(({ it }) => it);
}

/**
 * Hero özet cümlesi: KPI'ları TEKRARLAMAZ; en öncelikli işi adıyla ve bağlantısıyla söyler.
 * Kalem yoksa sakin durum + ilerletici tek bağlantı (sahte aciliyet yok).
 */
export function heroFocus(items: readonly HomeAttentionItem[]): { lead: string; text: string; href: string; rest: number } {
  const first = items[0];
  if (!first) return { lead: "Bugün acil bir konu görünmüyor.", text: "Yeni talepleri gözden geçirin", href: "/app/talepler?status=new", rest: 0 };
  return { lead: first.level === "acil" ? "Önce bununla başlayın:" : "Öncelik:", text: first.brief, href: first.href, rest: items.length - 1 };
}

/* ------------------------------ Aylık gelir eğrisi ----------------------------- */

const MONTH_SHORT = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** "2026-10" → "Eki". */
export function monthShortLabel(key: string): string {
  const m = Number(key.slice(5, 7));
  return MONTH_SHORT[m - 1] ?? key;
}

/** Eğri yalnız en az iki ay ve sıfırdan farklı bir değer varsa çizilir (düz sıfır çizgisi uydurma bir eğridir). */
export function revenueSeries(keys: readonly string[], totals: readonly number[]): { label: string; value: number }[] | null {
  const pts = keys.map((k, i) => ({ label: monthShortLabel(k), value: Number(totals[i] ?? 0) }));
  return pts.length >= 2 && pts.some((p) => p.value > 0) ? pts : null;
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
    { label: "Kazanılan anlaşma", value: i.won, href: "/app/anlasmalar?gorunum=liste&asama=won" },
  ];
  const max = Math.max(0, ...stages.map((s) => s.value));
  return stages.map((s) => ({
    ...s,
    sub: max > 0 && s.value !== max ? `%${Math.round((s.value / max) * 100)} · en yükseğe göre` : max > 0 ? "En yüksek aşama" : "",
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
