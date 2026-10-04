import { Lock } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Düzenleme izni olmayan rolde ayar formlarını salt okunur yapar (B10):
 * `fieldset disabled` içindeki tüm alanlar ve düğmeler pasifleşir, üstte açıklama görünür.
 * Sunucu eylemleri yetkiyi zaten reddeder; bu, sessiz hata yerine açık bir durum gösterir.
 */
export function ReadOnlyGate({ canEdit, children }: { canEdit: boolean; children: ReactNode }) {
  if (canEdit) return <>{children}</>;
  return (
    <div className="space-y-3">
      <p
        role="status"
        className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs font-medium text-text-muted"
      >
        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Bu bölümü yalnızca görüntüleyebilirsiniz; değiştirmek için ayar düzenleme yetkisi gerekir.
      </p>
      <fieldset disabled className="min-w-0 border-0 p-0 opacity-80">
        {children}
      </fieldset>
    </div>
  );
}
