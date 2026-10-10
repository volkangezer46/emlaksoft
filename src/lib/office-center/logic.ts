/**
 * Ofis Merkezi saf mantık (veri çekmez, saat okumaz): liste süzme/sıralama, URL filtre kontratı,
 * atanmamış ilan SLA durumu, ekip sağlığı uyarıları, danışman ligi (kazanç gizliliği korunur).
 */
import type { AdvisorMetricRow } from "@/lib/team/advisor-metrics";
import { OFFICE_CENTER_TABS, TEAM_HUB_PATH, type AdvisorListFilters, type AdvisorSortKey, type OfficeAdvisorRow, type OfficeCenterTab, type OfficeStatistics, type TeamHealth } from "./types";

type Sp = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORT_KEYS: readonly AdvisorSortKey[] = ["ad", "portfoy", "talep", "kapanis", "sla", "aktivite"];

/** Eski sekme adları (yer imleri) birleşik sekmeye düşer. */
const LEGACY_TABS: Readonly<Record<string, OfficeCenterTab>> = { ayarlar: "tanimlar", tanimlamalar: "tanimlar" };

export function parseTab(raw: string | string[] | undefined): OfficeCenterTab {
  const v = first(raw);
  if (Object.hasOwn(LEGACY_TABS, v)) return LEGACY_TABS[v]!;
  return OFFICE_CENTER_TABS.some((t) => t.id === v) ? (v as OfficeCenterTab) : "danismanlar";
}

/** TEK atama ekranı: İlan Havuzu (`?atama=`). Ofis Merkezi ve uyarılar buraya bağlanır. */
export const LISTING_POOL_PATH = "/app/ilan-havuzu";
export const ASSIGN_VIEWS = [
  { id: "bekleyen", label: "Bekleyen ilanlar" },
  { id: "gecikmis", label: "Gecikenler" },
  { id: "gecmis", label: "Geçmiş" },
  { id: "aktif", label: "Aktif atamalar" },
  { id: "iptal", label: "İptaller" },
  { id: "yeniden", label: "Yeniden atananlar" },
] as const;
export type AssignView = (typeof ASSIGN_VIEWS)[number]["id"];

export function parseAssignView(raw: string | string[] | undefined): AssignView {
  const v = first(raw);
  return ASSIGN_VIEWS.some((x) => x.id === v) ? (v as AssignView) : "bekleyen";
}

export function assignHref(view: AssignView = "bekleyen"): string {
  return `${LISTING_POOL_PATH}?atama=${view}`;
}

/** Danışmanlar sekmesi URL -> filtre (bozuk değer varsayılana düşer). */
export function parseAdvisorFilters(sp: Sp): AdvisorListFilters {
  const durum = first(sp.durum);
  const sirala = first(sp.sirala);
  const yon = first(sp.yon);
  return {
    q: first(sp.q).trim().slice(0, 80),
    durum: durum === "aktif" || durum === "pasif" ? durum : "",
    rol: /^[a-z_]{2,20}$/.test(first(sp.rol)) ? first(sp.rol) : "",
    sube: UUID_RE.test(first(sp.sube)) ? first(sp.sube) : "",
    sirala: SORT_KEYS.includes(sirala as AdvisorSortKey) ? (sirala as AdvisorSortKey) : "ad",
    yon: yon === "desc" ? "desc" : yon === "asc" ? "asc" : sirala && sirala !== "ad" ? "desc" : "asc",
  };
}

export function tabHref(tab: OfficeCenterTab, extra?: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  if (tab !== "danismanlar") p.set("sekme", tab);
  for (const [k, v] of Object.entries(extra ?? {})) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${TEAM_HUB_PATH}?${s}` : TEAM_HUB_PATH;
}

const norm = (s: string) => s.toLocaleLowerCase("tr-TR");

export function filterAdvisors(rows: readonly OfficeAdvisorRow[], f: AdvisorListFilters): OfficeAdvisorRow[] {
  const needle = norm(f.q);
  return rows.filter((r) => {
    if (f.durum === "aktif" && !r.isActive) return false;
    if (f.durum === "pasif" && r.isActive) return false;
    if (f.rol && r.role !== f.rol) return false;
    if (f.sube && r.branchId !== f.sube) return false;
    if (needle && !norm(r.fullName).includes(needle) && !norm(r.title ?? "").includes(needle) && !norm(r.teamName ?? "").includes(needle)) return false;
    return true;
  });
}

export function sortAdvisors(rows: readonly OfficeAdvisorRow[], key: AdvisorSortKey, dir: "asc" | "desc"): OfficeAdvisorRow[] {
  const sign = dir === "desc" ? -1 : 1;
  const nullLast = (a: number | null, b: number | null) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : sign * (a - b));
  return [...rows].sort((a, b) => {
    switch (key) {
      case "portfoy":
        return sign * (a.openProperties - b.openProperties) || a.fullName.localeCompare(b.fullName, "tr");
      case "talep":
        return sign * (a.openDemands - b.openDemands) || a.fullName.localeCompare(b.fullName, "tr");
      case "kapanis":
        return sign * (a.wonThisMonth - b.wonThisMonth) || a.fullName.localeCompare(b.fullName, "tr");
      case "sla":
        return nullLast(a.slaWithinPct, b.slaWithinPct) || a.fullName.localeCompare(b.fullName, "tr");
      case "aktivite":
        return nullLast(a.lastActivityAt ? Date.parse(a.lastActivityAt) : null, b.lastActivityAt ? Date.parse(b.lastActivityAt) : null) || a.fullName.localeCompare(b.fullName, "tr");
      default:
        return sign * a.fullName.localeCompare(b.fullName, "tr");
    }
  });
}

/** Atanmamış ilan SLA durumu: ofis ayarı (saat) ile ilanın beklediği süre. */
export function unassignedSlaState(sinceMs: number, nowMs: number, slaHours: number): "ok" | "due_soon" | "breached" {
  const waited = nowMs - sinceMs;
  const limit = Math.max(slaHours, 1) * 3_600_000;
  if (waited >= limit) return "breached";
  return limit - waited <= limit * 0.2 ? "due_soon" : "ok";
}

/** Ekip sağlığı: eşiklere göre uyarı listesi; her uyarı tıklanabilir hedef taşır. */
export function computeTeamHealth(input: {
  stats: OfficeStatistics;
  breachedUnassigned: number;
  unassignedThreshold: number;
  advisorsWithoutActivity30d: number;
}): TeamHealth {
  const alerts: TeamHealth["alerts"] = [];
  if (input.stats.unassignedProperties >= input.unassignedThreshold) {
    alerts.push({ text: `${input.stats.unassignedProperties} ilan danışmansız (eşik ${input.unassignedThreshold})`, href: assignHref() });
  }
  if (input.breachedUnassigned > 0) {
    alerts.push({ text: `${input.breachedUnassigned} ilan atama SLA'sını aştı`, href: assignHref("gecikmis") });
  }
  if (input.advisorsWithoutActivity30d > 0) {
    alerts.push({ text: `${input.advisorsWithoutActivity30d} aktif danışmanın 30 gündür aktivitesi yok`, href: tabHref("danismanlar", { sirala: "aktivite", yon: "asc", durum: "aktif" }) });
  }
  if (input.stats.assignmentsThisMonth > 0 && input.stats.cancelledAssignmentsThisMonth / input.stats.assignmentsThisMonth >= 0.3) {
    alerts.push({ text: `Bu ay atamaların %${Math.round((input.stats.cancelledAssignmentsThisMonth / input.stats.assignmentsThisMonth) * 100)}'i iptal edildi`, href: assignHref("iptal") });
  }
  if (input.stats.failed) alerts.push({ text: "Bazı sayılar okunamadı; sağlık değerlendirmesi eksik olabilir", href: tabHref("istatistikler") });
  const level: TeamHealth["level"] = alerts.length === 0 ? "healthy" : alerts.length >= 3 || input.breachedUnassigned > 0 ? "critical" : "warning";
  return { level, alerts };
}

export type LeagueEntry = {
  rank: number;
  advisorId: string;
  name: string;
  dealCount: number;
  offerCount: number;
  conversionPct: number | null;
  appointCount: number;
  callCount: number;
  /** Yalnız `revenueVisible` ise sayı; aksi halde null (kazanç gizliliği). */
  revenue: number | null;
};

/**
 * Danışman ligi: anlaşma, dönüşüm, randevu, çağrı sırasıyla; kazanç yalnız izleyici görebiliyorsa (advisor-metrics
 * başkasının gelirini zaten null verir; burada ayrıca `seeAllEarnings` yoksa kendi dışındakiler null kalır).
 */
export function buildLeague(rows: readonly AdvisorMetricRow[], opts: { viewerId: string; seeAllEarnings: boolean }): LeagueEntry[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.dealCount - a.dealCount ||
        (b.conversionPct ?? -1) - (a.conversionPct ?? -1) ||
        b.appointCount - a.appointCount ||
        b.callCount - a.callCount ||
        a.fullName.localeCompare(b.fullName, "tr"),
    )
    .map((r, i) => ({
      rank: i + 1,
      advisorId: r.id,
      name: r.fullName,
      dealCount: r.dealCount,
      offerCount: r.offerCount,
      conversionPct: r.conversionPct,
      appointCount: r.appointCount,
      callCount: r.callCount,
      revenue: opts.seeAllEarnings || r.id === opts.viewerId ? r.revenue : null,
    }));
}
