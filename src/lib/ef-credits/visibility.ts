/**
 * Kontör merkezi + rapor arşivi SAF kuralları (DB yok; sunucu/istemci güvenli).
 * Görünürlük (ef_reports RLS niyeti): danışman yalnız KENDİ raporunu görür; owner/gm ofisin tüm raporlarını görür.
 * Tüm zaman hesapları çağıranın verdiği epoch ms ile yapılır (clock.ts now()); burada Date.now() YOK.
 */
import { DAY_MS, trMonthStartMs, trNextMonthStartMs } from "@/lib/clock";
import type { EfReportRow } from "@/lib/ef-credits/types";

/** EmlakFiyati rapor geçerliliği (gün); expires_at gelmezse created_at + bu süre varsayılır. */
export const EF_REPORT_VALID_DAYS = 30;
/** Rapor listesi: görünürlük sonrası en çok bu kadar satır çekilir. */
export const EF_REPORT_FETCH_LIMIT = 200;

/** Kontör satın alma / bakiye / banner yetkisi: yalnız ofis sahibi ve genel müdür. */
export function canManageEfCredits(role: string | null | undefined): boolean {
  return role === "owner" || role === "gm";
}

/** Ofisin TÜM değerleme raporlarını görebilen roller. */
export function canViewAllEfReports(role: string | null | undefined): boolean {
  return canManageEfCredits(role);
}

export type EfViewer = { userId: string; role: string | null | undefined };

/** Görünürlük süzgeci: kendi raporu veya owner/gm. Sahibi bilinmeyen (user_id null) rapor yalnız owner/gm'e görünür. */
export function canViewReport(row: Pick<EfReportRow, "user_id">, viewer: EfViewer): boolean {
  if (canViewAllEfReports(viewer.role)) return true;
  return Boolean(viewer.userId) && row.user_id === viewer.userId;
}

export function filterVisibleReports<T extends Pick<EfReportRow, "user_id">>(rows: T[], viewer: EfViewer): T[] {
  return rows.filter((r) => canViewReport(r, viewer));
}

export type ReportValidity = { expired: boolean; daysLeft: number | null; expiresAtMs: number | null };

/** Kalan geçerlilik: expires_at yoksa created_at + 30 gün. Gün sayısı yukarı yuvarlanır (son gün = 1). */
export function reportValidity(row: Pick<EfReportRow, "created_at" | "expires_at">, nowMs: number): ReportValidity {
  const raw = row.expires_at ? Date.parse(row.expires_at) : Date.parse(row.created_at) + EF_REPORT_VALID_DAYS * DAY_MS;
  if (!Number.isFinite(raw)) return { expired: false, daysLeft: null, expiresAtMs: null };
  const left = raw - nowMs;
  if (left <= 0) return { expired: true, daysLeft: 0, expiresAtMs: raw };
  return { expired: false, daysLeft: Math.ceil(left / DAY_MS), expiresAtMs: raw };
}

export function validityLabel(v: ReportValidity): string {
  if (v.expired) return "Süresi doldu";
  if (v.daysLeft === null) return "Geçerlilik bilinmiyor";
  return v.daysLeft <= 1 ? "Son gün" : `${v.daysLeft} gün kaldı`;
}

export type PdfStatus = { taken: boolean; label: string };

export function pdfStatusOf(row: Pick<EfReportRow, "pdf_charged">, expired: boolean): PdfStatus {
  if (row.pdf_charged) return { taken: true, label: expired ? "PDF alındı (süresi doldu)" : "PDF alındı" };
  return { taken: false, label: expired ? "PDF alınmadı (süresi doldu)" : "PDF henüz alınmadı" };
}

export const EF_PDF_DEADLINE_WARNING = "PDF'i 30 gün içinde indirin: rapor süresi dolunca rapor ve PDF artık açılamaz.";

export type EfReportFilter = {
  /** YYYY-MM-DD (TR günü, dahil). */
  from?: string | null;
  to?: string | null;
  tip?: string | null;
  userId?: string | null;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanDay(v: string | null | undefined): string | null {
  return v && DAY_RE.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) ? v : null;
}

export function cleanTip(v: string | null | undefined): "arsa" | "konut" | null {
  return v === "arsa" || v === "konut" ? v : null;
}

/** Tarih/tip/kullanıcı süzgeci (görünürlükten SONRA uygulanır; görünürlüğü genişletmez). */
export function filterReports<T extends Pick<EfReportRow, "created_at" | "tip" | "user_id">>(rows: T[], f: EfReportFilter): T[] {
  const from = cleanDay(f.from);
  const to = cleanDay(f.to);
  const tip = cleanTip(f.tip);
  const fromMs = from ? Date.parse(`${from}T00:00:00+03:00`) : null;
  const toMs = to ? Date.parse(`${to}T00:00:00+03:00`) + DAY_MS : null;
  return rows.filter((r) => {
    const at = Date.parse(r.created_at);
    if (fromMs !== null && !(at >= fromMs)) return false;
    if (toMs !== null && !(at < toMs)) return false;
    if (tip && (r.tip === "konut" ? "konut" : "arsa") !== tip) return false;
    if (f.userId && r.user_id !== f.userId) return false;
    return true;
  });
}

export type MonthlyAllowanceView = {
  /** Planın bu ay verilmesi gereken hakkı (ek kullanıcı dahil). */
  entitlement: number;
  /** Bu TR ayında deftere işlenen plan kontörü. */
  grantedThisMonth: number;
  /** Bu TR ayında harcanan kontör (tüm kalemler). */
  spentThisMonth: number;
  /** Bu ayın hakkından henüz kullanılmayan (en çok bakiye kadar). */
  remainingOfMonthly: number;
  /** Sonraki yenileme (TR ay başı, epoch ms). */
  nextRenewalMs: number;
};

type MovementLike = { at: string | null; label: string; units: number; category?: string };

/** Defter satırlarından aylık hak sayacı. Plan kontörü satırı = etiketi "Plan kontörü" olan yükleme. */
export function monthlyAllowanceView(p: {
  entitlement: number;
  rows: MovementLike[];
  available: number | null;
  nowMs: number;
}): MonthlyAllowanceView {
  const start = trMonthStartMs(p.nowMs);
  const end = trNextMonthStartMs(p.nowMs);
  let granted = 0;
  let spent = 0;
  for (const r of p.rows) {
    const at = r.at ? Date.parse(r.at) : Number.NaN;
    if (!Number.isFinite(at) || at < start || at >= end) continue;
    if (r.units > 0 && r.label === "Plan kontörü") granted += r.units;
    // Süre dolumu (yanma) harcama sayılmaz.
    if (r.units < 0 && r.category !== "sona-erme") spent += -r.units;
  }
  const base = Math.max(0, granted - spent);
  const remaining = p.available === null ? base : Math.min(base, Math.max(0, p.available));
  return {
    entitlement: p.entitlement,
    grantedThisMonth: granted,
    spentThisMonth: spent,
    remainingOfMonthly: remaining,
    nextRenewalMs: end,
  };
}

/** Başlık rozeti gösterim kararı: yetki + modül açık + EF live. */
export function shouldShowEfBadge(p: {
  role: string | null | undefined;
  canAccessValuation: boolean;
  valuationClosed: boolean;
  efLive: boolean;
  impersonating?: boolean;
}): boolean {
  if (p.impersonating || p.valuationClosed || !p.efLive) return false;
  return canManageEfCredits(p.role) || p.canAccessValuation;
}

/** Düşük bakiye bandı: yalnız satın alma yetkili roller, modül açık, EF live ve bakiye düşük/boş. */
export function shouldShowLowBalanceBanner(p: {
  role: string | null | undefined;
  valuationClosed: boolean;
  efLive: boolean;
  state: "ok" | "low" | "empty" | null;
}): boolean {
  return canManageEfCredits(p.role) && !p.valuationClosed && p.efLive && (p.state === "low" || p.state === "empty");
}
