import type { EffectivePermissions } from "@/lib/permissions-effective";
import { effectiveHasPermission } from "@/lib/permissions-effective";

/**
 * Kazanç gizliliği (belge 3e): başkasının kazancını görmek ayrı bir izne bağlıdır
 * (`earnings_all`, "view"). Varsayılan matriste yalnız ofis sahibi, genel müdür ve
 * muhasebe sahiptir; şube müdürü / takım lideri komisyon modülünü görse bile
 * başkasının payını GÖRMEZ (ofis sahibi roller ekranından açabilir).
 *
 * Bu yardımcı yalnız arayüz/sunucu sayfası kapısıdır: veritabanı tarafı (RLS) Faz 2'dedir.
 */
export function canSeeAllEarnings(perms: EffectivePermissions): boolean {
  return effectiveHasPermission(perms, "earnings_all", "view");
}

/** Bir kazanç değerini görme hakkı: kendi kazancı her zaman, başkasınınki yalnız `earnings_all` ile. */
export function canSeeEarningsOf(
  perms: EffectivePermissions,
  viewerId: string,
  subjectId: string,
): boolean {
  return viewerId === subjectId || canSeeAllEarnings(perms);
}
