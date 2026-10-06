import { Building2, ShieldAlert } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { roleLabel } from "@/lib/role-labels";

/**
 * Ofis bağlamı gerektiren /app sayfalarında iki farklı "göremezsin" durumu TEK yerden anlatılır:
 *
 * - `StaffNoTenantNotice`: platform personeli (süper admin vb.) /app'e ofis bağlamı olmadan girer
 *   (`requireModulePage` -> `tenantId: null`). Bu bir yetki eksikliği değildir; sayfa bir ofisin verisini
 *   gösterir, görmek için ofise destek oturumuyla girilir.
 * - `RoleNotAllowedNotice`: ofis kullanıcısının rolü sayfaya yetmez; hangi rollerin görebildiği yazılır.
 */
export function StaffNoTenantNotice({ feature }: { feature: string }) {
  return (
    <div className="mx-auto max-w-xl py-12">
      <EmptyState
        icon={Building2}
        title={`${feature} bir ofisin verisini gösterir`}
        description="Platform hesabınızın kendi ofis verisi yok. Görmek için Ofisler listesinden bir ofise destek oturumuyla girin."
        action={{ href: "/admin/tenants", label: "Ofislere git" }}
        secondary={{ href: "/admin", label: "Yönetim paneline dön" }}
      />
    </div>
  );
}

export function RoleNotAllowedNotice({
  feature,
  allowedRoles,
  role,
  alternative,
}: {
  feature: string;
  /** Sayfayı görebilen rol anahtarları (etiketler `role-labels` tek kaynağından). */
  allowedRoles: readonly string[];
  /** Kullanıcının rolü (metinde "rolünüz: X" için). */
  role?: string | null;
  /** İkincil yönlendirme (örn. Performansım). */
  alternative?: { href: string; label: string };
}) {
  const roles = allowedRoles.map(roleLabel).join(", ");
  const yours = role ? ` Rolünüz: ${roleLabel(role)}.` : "";
  return (
    <div className="mx-auto max-w-xl py-12">
      <EmptyState
        icon={ShieldAlert}
        tone="amber"
        title={`${feature} rolünüze açık değil`}
        description={`Bu sayfayı yalnız şu roller görebilir: ${roles}.${yours} Erişim gerekiyorsa ofis sahibinizle görüşün.`}
        action={{ href: "/app", label: "Ana ekrana dön" }}
        secondary={alternative}
      />
    </div>
  );
}
