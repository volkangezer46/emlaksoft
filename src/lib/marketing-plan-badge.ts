import { findGate } from "@/lib/billing/page-gates";
import { getPlan } from "@/lib/billing/plans";

/**
 * Ana sayfadaki "hangi pakette" rozetleri: sayfa kilidi (page-gates.ts) tek kaynaktır, metin elle yazılmaz.
 * Paket adı verilen (admin etkin) tanımlardan okunur; yoksa plans.ts adı. En düşük pakette rozet yoktur.
 */
export function gateBadge(
  appPath: string,
  plans?: readonly { id: string; name: string }[],
): string | undefined {
  const gate = findGate(appPath);
  if (!gate || gate.minPlan === "advisor") return undefined;
  const name = plans?.find((p) => p.id === gate.minPlan)?.name ?? getPlan(gate.minPlan).name;
  return `${name} ve üzeri`;
}
