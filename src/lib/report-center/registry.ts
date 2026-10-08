/**
 * Rapor tanımı kayıt defteri — TEK kaynak. Yeni rapor = ilgili `catalog/*.ts` dosyasında tanım + buraya kayıt değildir:
 * katalog dosyasının dışa aktardığı dizi otomatik gelir; kimlik tekilliği ve izin/kolon/filtre sözleşmesi
 * `registry-contract.test.ts` ile doğrulanır.
 */
import { effectiveHasPermission, type EffectivePermissions } from "@/lib/permissions-effective";
import { platformCanAccess, type PlatformRole } from "@/lib/platform-access";
import { PLATFORM_REPORTS } from "./catalog/platform";
import { muhasebeFaturaDefteri } from "./catalog/platform-accounting";
import { ANALYSIS_REPORTS } from "./catalog/tenant-analysis";
import { CRM_REPORTS } from "./catalog/tenant-crm";
import { FINANCE_REPORTS } from "./catalog/tenant-finance";
import { SALES_REPORTS } from "./catalog/tenant-sales";
import { TEAM_REPORTS } from "./catalog/tenant-team";
import type { ReportCategory, ReportDef, ReportScope } from "./types";

export const TENANT_CATEGORIES: readonly ReportCategory[] = [
  { id: "musteri", label: "Müşteri ve talepler", description: "Müşteri, talep, tavsiye ve kaynak analizi" },
  { id: "portfoy", label: "Portföy ve ilanlar", description: "Portföy, portal ilanı, ilan kontrol ve kayıp-kaçak" },
  { id: "satis", label: "Satış hattı", description: "Randevu, görev, teklif, anlaşma ve çağrılar" },
  { id: "finans", label: "Finans ve komisyon", description: "Komisyon, gider, kâr/zarar, kira ve aidat" },
  { id: "ekip", label: "Ekip ve performans", description: "Danışman KPI, hedef, lig, ekip ve memnuniyet" },
  { id: "pazarlama", label: "Pazarlama", description: "Kampanya ve alıcı sonuçları" },
  { id: "ofis", label: "Ofis ve uyum", description: "Sözleşme, onay, denetim kaydı ve uyum defteri" },
];

export const PLATFORM_CATEGORIES: readonly ReportCategory[] = [
  { id: "platform", label: "Ofisler ve kullanıcılar", description: "Ofis, üye ve denetim kayıtları" },
  { id: "gelir", label: "Gelir ve abonelik", description: "Abonelik, fatura, tahsilat, kupon ve kredi hareketleri" },
  { id: "satis", label: "Satış ve büyüme", description: "Demo talepleri ve kayıt kaynakları" },
  { id: "destek", label: "Destek", description: "Destek talepleri ve SLA" },
];

export const TENANT_REPORT_LIST: readonly ReportDef[] = [...CRM_REPORTS, ...SALES_REPORTS, ...FINANCE_REPORTS, ...TEAM_REPORTS, ...ANALYSIS_REPORTS];
export const PLATFORM_REPORT_LIST: readonly ReportDef[] = [...PLATFORM_REPORTS, muhasebeFaturaDefteri];

export const ALL_REPORTS: readonly ReportDef[] = [...TENANT_REPORT_LIST, ...PLATFORM_REPORT_LIST];

export function reportsFor(scope: ReportScope): readonly ReportDef[] {
  return scope === "tenant" ? TENANT_REPORT_LIST : PLATFORM_REPORT_LIST;
}

export function categoriesFor(scope: ReportScope): readonly ReportCategory[] {
  return scope === "tenant" ? TENANT_CATEGORIES : PLATFORM_CATEGORIES;
}

export function getReport(scope: ReportScope, id: string): ReportDef | null {
  return reportsFor(scope).find((r) => r.id === id) ?? null;
}

export type TenantViewer = {
  perms: EffectivePermissions;
  role: string;
  /** `hasOfficeWideDataScope(role)` */
  officeWide: boolean;
  /** `earnings_all` izni */
  seeAllEarnings: boolean;
};

/** Raporu bu kullanıcı görebilir / indirebilir mi (sayfa listesi ve route AYNI kuralı kullanır). */
export function tenantReportAllowed(def: ReportDef, v: TenantViewer): boolean {
  if (def.scope !== "tenant" || !def.module) return false;
  if (!effectiveHasPermission(v.perms, def.module, "view")) return false;
  if (def.officeWideOnly && !v.officeWide) return false;
  if (def.earningsAllOnly && !v.seeAllEarnings) return false;
  if (def.rolesOnly && !def.rolesOnly.includes(v.role)) return false;
  return true;
}

export function platformReportAllowed(def: ReportDef, role: PlatformRole): boolean {
  return def.scope === "platform" && !!def.platformModule && platformCanAccess(role, def.platformModule);
}

export function visibleTenantReports(v: TenantViewer): ReportDef[] {
  return TENANT_REPORT_LIST.filter((d) => tenantReportAllowed(d, v));
}

export function visiblePlatformReports(role: PlatformRole): ReportDef[] {
  return PLATFORM_REPORT_LIST.filter((d) => platformReportAllowed(d, role));
}

const trFold = (s: string) => s.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

/** Başlık, açıklama ve anahtar sözcüklerde Türkçe-duyarsız arama. */
export function searchReports(list: readonly ReportDef[], q: string | undefined): ReportDef[] {
  const term = trFold((q ?? "").trim());
  if (!term) return [...list];
  const words = term.split(/\s+/);
  return list.filter((d) => {
    const hay = trFold(`${d.title} ${d.description} ${(d.keywords ?? []).join(" ")}`);
    return words.every((w) => hay.includes(w));
  });
}
