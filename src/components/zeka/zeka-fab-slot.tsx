import { zekaSurfaceEnabled } from "@/lib/ai/zeka/settings";
import type { ZekaSurface } from "@/lib/ai/zeka/types";
import { ZekaFab } from "./zeka-fab";

/**
 * Kabuk yuvası (sunucu): yüzey yönetimden kapatıldıysa düğme hiç çizilmez (uç nokta da yanıt vermez). /app ve /admin
 * layout'larının görünmez kabuk parçasına (ShellBoot) bir satırla eklenir; rol yalnız başlangıç sorusu seçimi içindir.
 */
export async function ZekaFabSlot({ surface, role, recentsKey }: { surface: Extract<ZekaSurface, "app" | "admin">; role?: string | null; recentsKey?: string | null }) {
  if (!(await zekaSurfaceEnabled(surface))) return null;
  return <ZekaFab surface={surface} role={role ?? null} recentsKey={recentsKey ?? null} />;
}
