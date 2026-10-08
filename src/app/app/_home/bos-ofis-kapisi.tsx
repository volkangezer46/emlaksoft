import type { ReactNode } from "react";
import { loadEmptyProbe, type HomeCtx } from "./data";

/**
 * Veri yokken (müşteri ve portföy 0) sıfır dolu blokları gizler; yerinde "Başlangıç" kartı (`baslangic-karti.tsx`)
 * ilk adımları gösterir. Veri varsa (ya da TV modunda / sayım okunamazsa) çocukları olduğu gibi akıtır.
 */
export async function BosOfisKapisi({ ctx, children }: { ctx: HomeCtx; children: ReactNode }) {
  if (ctx.tvMode) return <>{children}</>;
  const probe = await loadEmptyProbe(ctx);
  if (!probe || probe.customers > 0 || probe.properties > 0) return <>{children}</>;
  return null;
}
