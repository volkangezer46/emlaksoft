import { buildDedupeKey, monthPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { dayMs, nameOr } from "@/lib/insights/rules/common";
import { BUDGET_WARN_RATIO, type BudgetRow } from "@/lib/finance/expense-budget";
import { RECURRENCE_LABEL, renewalInfo, type RecurringSeries } from "@/lib/finance/recurring-expenses";
import { PORTAL_LABEL, type PortalRoiRow, type WorstPortal } from "@/lib/finance/portal-roi";

/**
 * GİDER içgörüleri (SAF). Alıcı yalnız YÖNETİM rolleridir (ofis giderleri danışmana gösterilmez).
 *
 *  expense_budget@1  Kategori bütçesinin %80'ine ulaşıldı (orta) / %100 aşıldı (yüksek → zil). Önceki aya sapma kanıtta.
 *  subscription@1    Tekrarlayan gider/aboneliğin yenilemesi 7 gün içinde (ya da kayıt girilmedi) + kullanılmayan portal aboneliği.
 *  portal_roi@1      En verimsiz portal (talep başına maliyet) — yalnız yeterli veri ve kıyas varsa.
 *
 * Veri yoksa kart yok: bütçe tanımsız kategori, yetersiz maliyet geçmişi, kıyas edilemeyen portal içgörü üretmez.
 */

export const EXPENSE_BUDGET_RULE_ID = "expense_budget@1";
export const SUBSCRIPTION_RULE_ID = "subscription@1";
export const PORTAL_ROI_RULE_ID = "portal_roi@1";
export const FINANCE_MAX_PER_RULE = 6;

const money = (n: number) => `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Math.round(n))} TL`;

/** Kısa, sabit kararlı özet (dedupe anahtarında Türkçe/özel karakter çakışmasını önler). */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/* ------------------------------ bütçe ------------------------------ */

export type BudgetFact = BudgetRow & { label: string };
export type BudgetFacts = { monthKey: string; monthStart: string; monthEnd: string; rows: readonly BudgetFact[] };

export function evaluateExpenseBudgets(facts: BudgetFacts, nowMs: number, monthEndMs: number): InsightDraft[] {
  const out: InsightDraft[] = [];
  for (const r of facts.rows) {
    if (!(r.budget > 0) || r.status === "ok") continue;
    const over = r.status === "over";
    const pct = Math.round(r.ratio * 100);
    const name = nameOr(r.label, "Gider");
    out.push({
      kind: "anomaly",
      ruleId: EXPENSE_BUDGET_RULE_ID,
      severity: over ? "yuksek" : "orta",
      title: over ? `Bütçe aşıldı (%${pct}): ${name}` : `Bütçenin %${Math.min(pct, 99)}'ine ulaşıldı: ${name}`,
      why: over
        ? `${name} giderleri bu ay ${money(r.spent)} oldu; aylık bütçe ${money(r.budget)}. Aşım ${money(Math.abs(r.remaining))}. Kalan harcamaları gözden geçirin veya bütçeyi bilinçli olarak güncelleyin.`
        : `${name} giderleri bu ay ${money(r.spent)}; aylık bütçe ${money(r.budget)} ve ay bitmeden %${Math.round(BUDGET_WARN_RATIO * 100)} eşiği geçildi. Kalan: ${money(r.remaining)}.`,
      evidence: [
        { label: "Bu ay", value: money(r.spent) },
        { label: "Aylık bütçe", value: money(r.budget) },
        { label: "Kullanım", value: `%${pct}` },
        {
          label: "Önceki aya göre",
          value: r.deltaPctVsPrev === null ? (r.prevSpent > 0 ? money(r.deltaVsPrev) : "önceki ay gider yok") : `${r.deltaPctVsPrev >= 0 ? "+" : ""}%${r.deltaPctVsPrev}`,
        },
      ],
      href: `/app/giderler?kategori=${encodeURIComponent(r.category)}&from=${facts.monthStart}&to=${facts.monthEnd}#butce`,
      entityType: null,
      entityId: null,
      isForecast: false,
      confidence: null,
      // Eşik geçişi (warn → over) yeni içgörü + yeni zil bildirimi üretir.
      dedupeKey: buildDedupeKey("fin-budget", shortHash(r.category), `${facts.monthKey}-${over ? "over" : "warn"}`),
      validUntilMs: Math.max(nowMs + dayMs(1), monthEndMs),
      audience: { type: "management" },
      urgencyDays: null,
      impact: over ? Math.min(10, 5 + Math.round(Math.abs(r.remaining) / Math.max(1, r.budget) * 10)) : 4,
    });
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "yuksek" ? -1 : 1)).slice(0, FINANCE_MAX_PER_RULE);
}

/* ------------------------------ abonelik ------------------------------ */

export type SubscriptionFacts = {
  todayKey: string;
  series: readonly (RecurringSeries & { categoryLabel: string })[];
  unusedPortals: readonly PortalRoiRow[];
};

export function evaluateSubscriptions(facts: SubscriptionFacts, nowMs: number): InsightDraft[] {
  const out: InsightDraft[] = [];
  const month = monthPeriod(nowMs);
  for (const s of facts.series) {
    const info = renewalInfo(s, facts.todayKey);
    if (info.state !== "due_soon" && info.state !== "overdue") continue;
    const name = nameOr(s.title, "Abonelik");
    const overdue = info.state === "overdue";
    out.push({
      kind: "deadline",
      ruleId: SUBSCRIPTION_RULE_ID,
      severity: overdue ? "orta" : "bilgi",
      title: overdue ? `Yenileme tarihi geçti, kayıt yok: ${name}` : info.daysLeft === 0 ? `Bugün yenileniyor: ${name}` : `${info.daysLeft} gün sonra yenileniyor: ${name}`,
      why: overdue
        ? `${RECURRENCE_LABEL[s.recurrence]} gider olarak işaretli; beklenen yenileme ${s.nextDue} idi ama yeni ödeme kaydı girilmedi. Ödendiyse kaydı ekleyin, iptal edildiyse tekrarlamayı kapatın.`
        : `${RECURRENCE_LABEL[s.recurrence]} tekrarlayan gider (${money(s.lastAmount)}). İhtiyacınız sürüyorsa yenileyin; değilse yenileme tarihinden önce iptal edin.`,
      evidence: [
        { label: "Son ödeme", value: `${s.lastDate} · ${money(s.lastAmount)}` },
        { label: "Beklenen yenileme", value: s.nextDue },
        { label: "Dönem", value: RECURRENCE_LABEL[s.recurrence] },
      ],
      href: `/app/giderler?kategori=${encodeURIComponent(s.category)}#abonelikler`,
      entityType: null,
      entityId: null,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("fin-renew", shortHash(s.key), s.nextDue),
      validUntilMs: nowMs + dayMs(overdue ? 7 : Math.max(1, info.daysLeft + 1)),
      audience: { type: "management" },
      urgencyDays: info.daysLeft,
      impact: Math.min(8, Math.max(2, Math.round(Math.log10(Math.max(10, s.lastAmount))))),
    });
  }
  for (const r of facts.unusedPortals) {
    out.push({
      kind: "anomaly",
      ruleId: SUBSCRIPTION_RULE_ID,
      severity: "orta",
      title: `${PORTAL_LABEL[r.portalKey]} aboneliği kullanılmıyor olabilir`,
      why: `Son 90 günde ${PORTAL_LABEL[r.portalKey]} için ${money(r.cost)} gider payı var; aynı sürede bu portalda ilan yayınlanmadı, şu an yayında ilan yok ve bu portaldan talep gelmedi. Aboneliği sorgulayın veya iptal edin.`,
      evidence: [
        { label: "90 günlük maliyet", value: money(r.cost) },
        { label: "Yayındaki ilan", value: "0" },
        { label: "Gelen talep", value: "0" },
      ],
      href: `/app/giderler?portal=${r.portalKey}#portal-getirisi`,
      entityType: null,
      entityId: null,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("fin-unused", r.portalKey, month),
      validUntilMs: nowMs + dayMs(30),
      audience: { type: "management" },
      urgencyDays: null,
      impact: Math.min(10, Math.max(3, Math.round(Math.log10(Math.max(10, r.cost))) + 1)),
    });
  }
  return out.slice(0, FINANCE_MAX_PER_RULE);
}

/* ------------------------------ portal ROI ------------------------------ */

export function evaluatePortalRoi(worst: WorstPortal | null, rows: readonly PortalRoiRow[], nowMs: number): InsightDraft[] {
  if (!worst) return [];
  const row = rows.find((r) => r.portalKey === worst.portalKey);
  if (!row || !row.sufficient) return [];
  const month = monthPeriod(nowMs);
  const label = PORTAL_LABEL[worst.portalKey];
  const common = {
    kind: "anomaly" as const,
    ruleId: PORTAL_ROI_RULE_ID,
    severity: "orta" as const,
    href: `/app/giderler?portal=${worst.portalKey}#portal-getirisi`,
    entityType: null,
    entityId: null,
    isForecast: false,
    confidence: null,
    dedupeKey: buildDedupeKey("fin-portal", worst.portalKey, month),
    validUntilMs: nowMs + dayMs(30),
    audience: { type: "management" as const },
    urgencyDays: null,
    impact: 6,
  };
  if (worst.kind === "no_leads") {
    return [
      {
        ...common,
        title: `${label}: ilan yayında ama talep gelmiyor`,
        why: `${label} için son 90 günde ${money(worst.cost)} gider payı var, ${worst.liveListings} ilan yayında, ancak bu portaldan hiç talep kaydedilmedi. Kaynak alanı boş girilmiş olabilir; değilse aboneliği veya ilan kalitesini gözden geçirin.`,
        evidence: [
          { label: "90 günlük maliyet", value: money(worst.cost) },
          { label: "Yayındaki ilan", value: String(worst.liveListings) },
          { label: "Gelen talep", value: "0" },
        ],
      },
    ];
  }
  return [
    {
      ...common,
      title: `${label}: talep başına maliyet en yüksek (${money(worst.costPerLead)})`,
      why: `${label}'ten gelen talebin maliyeti ${money(worst.costPerLead)}; en verimli portal ${PORTAL_LABEL[worst.benchmarkKey]} ${money(worst.benchmarkCostPerLead)}. Bütçeyi verimli portala kaydırmayı veya paketi küçültmeyi değerlendirin.`,
      evidence: [
        { label: `${label} talep başına`, value: money(worst.costPerLead) },
        { label: `${PORTAL_LABEL[worst.benchmarkKey]} talep başına`, value: money(worst.benchmarkCostPerLead) },
        { label: "Dönem", value: "son 90 gün" },
      ],
    },
  ];
}
