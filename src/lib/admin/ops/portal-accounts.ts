import { CURRENT_PORTALS, PORTAL_LABELS, type CurrentPortal } from "@/lib/portals/catalog";

/**
 * PORTAL HESAPLARI (saf, yan etkisiz). Kaynaklar: `tenant_portal_accounts` (ofis × portal: sahibinden / hepsiemlak /
 * emlakjet hesabı, paket bitişi, eklentinin son başarılı/başarısız girişi, ardışık hata) ve `portal_listing_health`
 * (ilanın portalda hâlâ yayında olup olmadığının doğrulama durumu). Bu modül sorunlu hesabı sınıflandırır ve portal
 * bazında özet çıkarır; okuyucu `portal-accounts-read.ts`.
 */

/** Portal listesi ve adları TEK kaynaktan (`@/lib/portals/catalog`; sabit liste yasak, membership.test.ts). */
export const PORTALS = CURRENT_PORTALS;
export type PortalKey = CurrentPortal;
export const PORTAL_LABEL: Readonly<Record<PortalKey, string>> = PORTAL_LABELS;

export type PortalAccountRow = {
  tenantId: string;
  portal: PortalKey;
  status: "active" | "none" | "unknown";
  checkEnabled: boolean;
  planEndsAt: string | null;
  lastLoginOkAt: string | null;
  lastLoginFailAt: string | null;
  loginFailStreak: number;
};

export type PortalIssue = "giris_hatasi" | "paket_bitti" | "paket_bitiyor" | "kontrol_kapali" | "dogrulanmadi";

export const PORTAL_ISSUE_LABEL: Record<PortalIssue, string> = {
  giris_hatasi: "Giriş başarısız",
  paket_bitti: "Portal paketi bitti",
  paket_bitiyor: "Paket 7 gün içinde bitiyor",
  kontrol_kapali: "İlan kontrolü kapalı",
  dogrulanmadi: "Hesap hiç doğrulanmadı",
};

export const PORTAL_ISSUE_TONE: Record<PortalIssue, "danger" | "warning" | "neutral"> = {
  giris_hatasi: "danger",
  paket_bitti: "danger",
  paket_bitiyor: "warning",
  kontrol_kapali: "neutral",
  dogrulanmadi: "warning",
};

/** Ardışık bu kadar başarısız eklenti girişi = hesap sorunu (parola değişti / kilitlendi). */
export const LOGIN_FAIL_STREAK_ALERT = 3;

const ISSUE_RANK: Record<PortalIssue, number> = { giris_hatasi: 0, paket_bitti: 1, paket_bitiyor: 2, dogrulanmadi: 3, kontrol_kapali: 4 };

/** Hesabın en önemli sorunu (yoksa null). Yalnız `active` beyan edilen hesap değerlendirilir. */
export function portalAccountIssue(a: PortalAccountRow, todayKey: string): PortalIssue | null {
  if (a.status !== "active") return null;
  if (a.loginFailStreak >= LOGIN_FAIL_STREAK_ALERT) return "giris_hatasi";
  if (a.planEndsAt && a.planEndsAt < todayKey) return "paket_bitti";
  if (a.planEndsAt && a.planEndsAt <= addDays(todayKey, 7)) return "paket_bitiyor";
  if (!a.checkEnabled) return "kontrol_kapali";
  if (!a.lastLoginOkAt && !a.lastLoginFailAt) return "dogrulanmadi";
  return null;
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export type PortalSummary = {
  portal: PortalKey;
  active: number;
  offices: number;
  issues: Record<PortalIssue, number>;
};

export type PortalOverview = {
  portals: PortalSummary[];
  accounts: number;
  issueRows: (PortalAccountRow & { issue: PortalIssue })[];
};

export function summarizePortalAccounts(rows: readonly PortalAccountRow[], todayKey: string, limit = 40): PortalOverview {
  const blank = (): Record<PortalIssue, number> => ({ giris_hatasi: 0, paket_bitti: 0, paket_bitiyor: 0, kontrol_kapali: 0, dogrulanmadi: 0 });
  const by = new Map<PortalKey, { active: number; offices: Set<string>; issues: Record<PortalIssue, number> }>();
  for (const p of PORTALS) by.set(p, { active: 0, offices: new Set(), issues: blank() });
  const issueRows: (PortalAccountRow & { issue: PortalIssue })[] = [];
  let accounts = 0;
  for (const r of rows) {
    const s = by.get(r.portal);
    if (!s) continue;
    if (r.status === "active") {
      accounts += 1;
      s.active += 1;
      s.offices.add(r.tenantId);
    }
    const issue = portalAccountIssue(r, todayKey);
    if (issue) {
      s.issues[issue] += 1;
      issueRows.push({ ...r, issue });
    }
  }
  issueRows.sort((a, b) => ISSUE_RANK[a.issue] - ISSUE_RANK[b.issue] || b.loginFailStreak - a.loginFailStreak || (a.planEndsAt ?? "9").localeCompare(b.planEndsAt ?? "9"));
  return {
    portals: PORTALS.map((portal) => {
      const s = by.get(portal)!;
      return { portal, active: s.active, offices: s.offices.size, issues: s.issues };
    }),
    accounts,
    issueRows: issueRows.slice(0, limit),
  };
}

/** `portal_listing_health.check_state` değerleri (doğrulama hattı). */
export const LISTING_STATES = ["verified", "suspect", "probable_missing", "confirmed_missing", "unverifiable", "unchecked", "paused"] as const;
export type ListingState = (typeof LISTING_STATES)[number];
export const LISTING_STATE_LABEL: Record<ListingState, string> = {
  verified: "Yayında doğrulandı",
  suspect: "Şüpheli",
  probable_missing: "Muhtemelen kalkmış",
  confirmed_missing: "Kalktığı doğrulandı",
  unverifiable: "Doğrulanamıyor",
  unchecked: "Henüz kontrol edilmedi",
  paused: "Kontrol duraklatıldı",
};
export const LISTING_STATE_TONE: Record<ListingState, "success" | "warning" | "danger" | "neutral" | "info"> = {
  verified: "success",
  suspect: "warning",
  probable_missing: "warning",
  confirmed_missing: "danger",
  unverifiable: "info",
  unchecked: "neutral",
  paused: "neutral",
};

/** Sorunlu ilanı en çok olan ofisler (şüpheli + muhtemel/kesin kalkmış). */
export function listingProblemOffices(rows: readonly { tenantId: string; state: ListingState }[], limit = 10): { tenantId: string; suspect: number; missing: number }[] {
  const by = new Map<string, { suspect: number; missing: number }>();
  for (const r of rows) {
    const o = by.get(r.tenantId) ?? { suspect: 0, missing: 0 };
    if (r.state === "suspect") o.suspect += 1;
    else if (r.state === "probable_missing" || r.state === "confirmed_missing") o.missing += 1;
    else continue;
    by.set(r.tenantId, o);
  }
  return [...by.entries()]
    .map(([tenantId, o]) => ({ tenantId, ...o }))
    .sort((a, b) => b.missing + b.suspect - (a.missing + a.suspect))
    .slice(0, limit);
}
