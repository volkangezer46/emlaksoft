import type { AppModule } from "@/lib/permissions";
import { effectiveCanAccessModule, effectiveHasPermission, type EffectivePermissions } from "@/lib/permissions-merge";
import { featureForPermissionModule } from "@/lib/modules/guard";
import { featureForHref } from "@/lib/modules/route-table";
import { isHrefLocked } from "@/lib/billing/locked-href";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { canSeeAllEarnings } from "@/lib/team/earnings-scope";
import type { ZekaAction, ZekaCard } from "./types";

/**
 * Ofis kullanıcısının Zeka kapsamı (SAF). Kaynaklar: etkin izin (`permissions-effective`), ofisin kapattığı modüller
 * (`modules/state`), paket kilidi (`billing/page-gates`), veri kapsamı (`hasOfficeWideDataScope`), kazanç gizliliği
 * (`earnings_all`). Araçlar ve bilgi tabanı yalnız bu kapsamdan geçen veriyi görür; satır düzeyinde RLS ayrıca uygulanır.
 */
export type ZekaAppScope = {
  userId: string;
  tenantId: string;
  role: string;
  perms: EffectivePermissions;
  /** Ofisin kapattığı ürün modülleri (FeatureKey). */
  closed: readonly string[];
  /** Paket kilitli yollar (`lockedHrefs`). */
  locked: readonly string[];
  /** Destek oturumu / salt okunur: oluşturma önerilmez. */
  readOnly: boolean;
};

export function makeScope(input: Omit<ZekaAppScope, "readOnly"> & { readOnly?: boolean }): ZekaAppScope {
  return { ...input, readOnly: input.readOnly ?? input.role === "readonly" };
}

export function canView(s: ZekaAppScope, mod: AppModule): boolean {
  if (!effectiveCanAccessModule(s.perms, mod)) return false;
  const feature = featureForPermissionModule(mod);
  return !(feature && s.closed.includes(feature));
}

export function canCreate(s: ZekaAppScope, mod: AppModule): boolean {
  return !s.readOnly && canView(s, mod) && effectiveHasPermission(s.perms, mod, "create");
}

export function hrefBlocked(s: ZekaAppScope, href: string): boolean {
  const feature = featureForHref(href.split(/[?#]/)[0] ?? href);
  if (feature && s.closed.includes(feature)) return true;
  return isHrefLocked(href, s.locked);
}

export function officeWide(s: ZekaAppScope): boolean {
  return hasOfficeWideDataScope(s.role);
}

/** Ofis geneli tutar/kazanç (ciro, bekleyen komisyon toplamı, danışman sıralaması tutarı) yalnız `earnings_all`. */
export function earningsAll(s: ZekaAppScope): boolean {
  return canSeeAllEarnings(s.perms);
}

/**
 * Son süzgeç (tek boğaz noktası): kapalı modül ya da paket kilitli yola giden eylem ve kayıt/sayfa kartı yanıttan
 * çıkarılır; sayı/yardım kartında yalnız bağlantı düşer. Araçlar kendi içinde de süzer; bu, doğrudan kurulan
 * "Listeyi aç" gibi bağlantıların da kilide takılmasını garanti eder.
 */
export function withoutBlockedLinks<T extends { actions: ZekaAction[]; cards: ZekaCard[] }>(s: ZekaAppScope, result: T): T {
  const blocked = (href: string | undefined) => Boolean(href) && hrefBlocked(s, href!);
  const cards: ZekaCard[] = [];
  for (const c of result.cards) {
    if (c.kind === "record" || c.kind === "nav") {
      if (!blocked(c.href)) cards.push(c);
    } else if (blocked(c.href)) {
      const { href: _drop, ...rest } = c;
      void _drop;
      cards.push(rest as ZekaCard);
    } else cards.push(c);
  }
  return { ...result, actions: result.actions.filter((a) => !blocked(a.href)), cards };
}
