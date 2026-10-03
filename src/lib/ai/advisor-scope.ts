import type { EffectivePermissions } from "@/lib/permissions-effective";
import {
  getTenantAdvisorCapabilities,
  hasOfficeWideDataScope,
  type TenantAdvisorCapabilities,
} from "@/lib/permission-data-scope";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";

/**
 * AI asistan bağlamının yetki kapsamı (denetim B3): hangi veri kümeleri okunabilir,
 * satırlar ofis geneli mi yoksa yalnız kullanıcının kendi kayıtları mı, komisyon toplamı görünür mü.
 */
export type AdvisorScope = TenantAdvisorCapabilities & {
  userId: string;
  officeWide: boolean;
  /** Bekleyen komisyon toplamı yalnız `earnings_all` sahibine. */
  commissionTotal: boolean;
};

export function buildAdvisorScope(
  perms: EffectivePermissions,
  role: string | null | undefined,
  userId: string,
): AdvisorScope {
  const caps = getTenantAdvisorCapabilities(perms);
  return {
    ...caps,
    userId,
    officeWide: hasOfficeWideDataScope(role),
    commissionTotal: caps.commissions && canSeeAllEarnings(perms),
  };
}

const EMPTY = { data: null, count: null, error: null } as const;

/** İzin yoksa sorguyu hiç kurmadan boş sonuç döndürür. */
export function gated<T>(on: boolean, run: () => T): T | Promise<typeof EMPTY> {
  return on ? run() : Promise.resolve(EMPTY);
}
