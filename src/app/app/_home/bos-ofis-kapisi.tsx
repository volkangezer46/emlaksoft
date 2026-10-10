import type { ReactNode } from "react";
import { loadEmptyProbe, warmHomeFirstScreen, type HomeCtx } from "./data";
import { homeLayoutFor } from "./home-layout";

/**
 * Veri yokken (müşteri ve portföy 0) sıfır dolu blokları gizler; yerinde "Başlangıç" kartı (`baslangic-karti.tsx`)
 * ilk adımları gösterir. Veri varsa (ya da TV modunda / sayım okunamazsa) çocukları olduğu gibi akıtır.
 *
 * HIZ: kapı çocukları beklettiği için ilk ekran yükleyicileri BURADA, sayım beklenmeden başlatılır (`warmHomeFirstScreen`):
 * sayım turu ile blokların veri turları art arda değil yan yana akar.
 */
export async function BosOfisKapisi({ ctx, children }: { ctx: HomeCtx; children: ReactNode }) {
  if (ctx.tvMode) return <>{children}</>;
  warmHomeFirstScreen(ctx, homeLayoutFor(ctx.role));
  const probe = await loadEmptyProbe(ctx);
  if (!probe || probe.customers > 0 || probe.properties > 0) return <>{children}</>;
  return null;
}
