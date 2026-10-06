/**
 * İlan Kontrol günlük/haftalık rapor özeti (SAF). Dürüstlük: veri yoksa (hiç açık uyarı, hiç yeni uyarı, hiç çözülen)
 * rapor ÜRETİLMEZ (null); "her şey yolunda" gürültüsü ve uydurma özet yok. Tüm sayılar `listing_anomalies`'ten gelir.
 */

export type ReportPeriod = "daily" | "weekly";

export type ControlReportFacts = {
  open: number;
  /** SLA süresi geçmiş açık uyarı. */
  overdue: number;
  /** Pencerede (24 saat / 7 gün) yeni açılan uyarı. */
  opened: number;
  /** Pencerede çözülen/otomatik kapanan uyarı. */
  resolved: number;
  /** En çok uyarısı olan tür etiketi (varsa). */
  topTypeLabel: string | null;
  topTypeCount: number;
};

export type ControlReport = {
  title: string;
  body: string;
  href: string;
  kind: "info" | "warning" | "danger";
};

export function windowMs(period: ReportPeriod): number {
  return period === "daily" ? 86_400_000 : 7 * 86_400_000;
}

/** Dedupe için dönem anahtarı: günlük = UTC gün, haftalık = 7 günlük kova. Aynı dönem iki kez bildirilmez. */
export function reportPeriodKey(period: ReportPeriod, nowMs: number): string {
  const day = Math.floor(nowMs / 86_400_000);
  return period === "daily" ? `d${day}` : `w${Math.floor((day + 3) / 7)}`;
}

export function buildControlReport(period: ReportPeriod, f: ControlReportFacts): ControlReport | null {
  if (f.open === 0 && f.opened === 0 && f.resolved === 0) return null;
  const head = period === "daily" ? "Günlük İlan Kontrol özeti" : "Haftalık İlan Kontrol özeti";
  const span = period === "daily" ? "son 24 saatte" : "son 7 günde";
  const parts = [`${f.open} açık uyarı`];
  if (f.overdue > 0) parts.push(`${f.overdue} süresi geçmiş`);
  parts.push(`${span} ${f.opened} yeni, ${f.resolved} çözüldü`);
  if (f.topTypeLabel && f.topTypeCount > 0) parts.push(`en çok: ${f.topTypeLabel} (${f.topTypeCount})`);
  return {
    title: head,
    body: parts.join(" · "),
    href: f.overdue > 0 ? "/app/ilan-kontrol/anomaliler" : "/app/ilan-kontrol/rapor",
    kind: f.overdue > 0 ? "warning" : "info",
  };
}
