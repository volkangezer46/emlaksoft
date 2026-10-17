import { zekaSurfaceEnabled } from "@/lib/ai/zeka/settings";
import type { ZekaSurface } from "@/lib/ai/zeka/types";
import { ZekaFab } from "./zeka-fab";

/**
 * Kabuk yuvası (sunucu): yüzey yönetimden kapatıldıysa düğme hiç çizilmez (uç nokta da yanıt vermez). /app ve /admin
 * layout'larının görünmez kabuk parçasına (ShellBoot) bir satırla eklenir; rol yalnız başlangıç sorusu seçimi, ad yalnız
 * karşılama ("Merhaba Ayşe,") içindir.
 */
export async function ZekaFabSlot({ surface, role, recentsKey, userName }: { surface: Extract<ZekaSurface, "app" | "admin">; role?: string | null; recentsKey?: string | null; userName?: string | null }) {
  if (!(await zekaSurfaceEnabled(surface))) return null;
  return <ZekaFab surface={surface} role={role ?? null} recentsKey={recentsKey ?? null} userName={userName ?? null} />;
}
