import type { ControlChanges } from "@/lib/listing-control/server/readers";
import { CONTROL_BASE, healthyPercent, kpiHref, type SummaryNumbers } from "./helpers";

/**
 * YÖNETİCİ/DANIŞMAN ÖZETİ için OLGULAR (SAF). Tek doğruluk kaynağı: veritabanı KPI/değişim RPC'lerinin sayıları.
 * Hem kural tabanlı metin hem AI istemi YALNIZ bu listeden üretilir; AI çıktısındaki her sayı bu listede geçmek
 * zorundadır (`narrative-guard.acceptNarrative`). Her olgunun tıklanabilir hedefi vardır (sıfır çıkmaz metrik).
 * Kişisel veri YOKTUR: yalnız sayılar ve sabit etiketler.
 */

export type ReportPeriod = "day" | "week";
export type ReportAudience = "manager" | "advisor";

export type ReportFact = { key: string; label: string; value: number; href: string };

export const PERIOD_LABEL: Record<ReportPeriod, string> = { day: "Son 24 saat", week: "Son 7 gün" };

export function buildReportFacts(summary: SummaryNumbers, changes: ControlChanges | null): ReportFact[] {
  const facts: ReportFact[] = [
    { key: "total_active", label: "Aktif portföy", value: summary.total_active, href: kpiHref("active") },
    { key: "portal_missing", label: "Portalda kayıp ilan", value: summary.portal_missing, href: kpiHref("portal_missing") },
    { key: "awaiting_publish", label: "Yayınlanmayı bekleyen portföy", value: summary.awaiting_publish, href: kpiHref("awaiting_publish") },
    { key: "price_mismatch", label: "Fiyatı uyuşmayan ilan", value: summary.price_mismatch, href: kpiHref("price_mismatch") },
    { key: "in_review", label: "Açıklama bekleyen portföy", value: summary.in_review, href: kpiHref("in_review") },
    { key: "unverifiable", label: "Kontrol edilemeyen ilan", value: summary.unverifiable, href: kpiHref("unverifiable") },
  ];
  const pct = healthyPercent(summary);
  if (pct !== null) facts.push({ key: "healthy_percent", label: "Sağlıklı portföy yüzdesi", value: pct, href: kpiHref("healthy") });
  if (changes) {
    const anomalies = `${CONTROL_BASE}/anomaliler`;
    facts.push(
      { key: "anomalies_opened", label: "Yeni açılan uyarı", value: changes.anomalies_opened, href: anomalies },
      { key: "anomalies_closed", label: "Kapanan uyarı", value: changes.anomalies_closed, href: anomalies },
      { key: "newly_missing", label: "Yeni kaybolan ilan", value: changes.newly_missing, href: kpiHref("portal_missing") },
      { key: "recovered", label: "Geri gelen ilan", value: changes.recovered, href: kpiHref("in_portals") },
      { key: "checks_total", label: "Yapılan kontrol", value: changes.checks_total, href: kpiHref("in_portals") },
    );
  }
  return facts;
}

/** Modele giden metin: dönem + satır satır "etiket: sayı". Başka hiçbir şey yok. */
export function factsToPromptInput(period: ReportPeriod, audience: ReportAudience, facts: readonly ReportFact[]): string {
  const head = `Dönem: ${PERIOD_LABEL[period]}. Okuyucu: ${audience === "manager" ? "ofis yöneticisi" : "danışman"}.`;
  return [head, ...facts.map((f) => `- ${f.label}: ${f.value}`)].join("\n");
}

/** AI kapalı/başarısız olduğunda gösterilen kural tabanlı özet (aynı olgulardan; uydurma yok). */
export function ruleBasedSummary(period: ReportPeriod, facts: readonly ReportFact[]): string[] {
  const v = (k: string) => facts.find((f) => f.key === k)?.value;
  const out: string[] = [];
  const total = v("total_active");
  if (total === undefined || total === 0) return ["Kontrol kapsamında aktif portföy yok."];
  out.push(`${PERIOD_LABEL[period]} içinde ${total} aktif portföy izleniyor.`);
  const missing = v("portal_missing") ?? 0;
  out.push(missing > 0 ? `${missing} portföyde portal ilanı kayıp görünüyor; önce bunlara bakın.` : "Portal ilanı kayıp görünen portföy yok.");
  const review = v("in_review") ?? 0;
  if (review > 0) out.push(`${review} portföyde açıklama bekleniyor.`);
  const waiting = v("awaiting_publish") ?? 0;
  if (waiting > 0) out.push(`${waiting} portföy yayınlanmayı bekliyor.`);
  const price = v("price_mismatch") ?? 0;
  if (price > 0) out.push(`${price} ilanda portal fiyatı CRM'den farklı.`);
  const opened = v("anomalies_opened");
  const closed = v("anomalies_closed");
  if (opened !== undefined && closed !== undefined) out.push(`Dönemde ${opened} uyarı açıldı, ${closed} uyarı kapandı.`);
  return out;
}
