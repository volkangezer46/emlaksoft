import { Sparkles } from "lucide-react";
import type { BriefingItem, BriefingTone } from "@/lib/briefing";
import { generateBriefingSummary } from "@/lib/ai/briefing-summary";
import type { HomeCtx } from "./data";
import type { AttentionLevelKey, HomeAttentionItem } from "./home-metrics";

/**
 * Opsiyonel AI özet satırı ("Dikkat gerektirenler" kartının altında). Eski "Bugün kuyruğu" listesi KALDIRILDI:
 * sayılarını diğer bloklar zaten gösteriyordu; kalemler artık tek kaynaktan (`loadAttention`) gelir ve bu satır
 * yalnız onları tek cümleye indirir. Suspense içinde ayrı akar; OpenAI anahtarı/kota yoksa ya da hata olursa hiç
 * görünmez. Çıktıdaki her sayı girdide geçmek zorundadır (lib/ai/briefing-summary).
 */
const LEVEL_TONE: Record<AttentionLevelKey, BriefingTone> = { acil: "danger", yuksek: "warn", orta: "amber", dusuk: "brand" };

export async function BugunAiOzet({ attention, ctx }: { attention: readonly HomeAttentionItem[]; ctx: HomeCtx }) {
  // audit ZORUNLU (kredi defteri + denetim izi); tenant yoksa çağrı yapılmaz. Günlük önbellek + kota kapısı lib'de.
  if (!ctx.tenantId) return null;
  if (attention.length === 0) return null;
  const items: BriefingItem[] = attention.map((i) => ({ icon: "", text: i.brief, href: i.href, tone: LEVEL_TONE[i.level] }));
  const summary = await generateBriefingSummary(items, { tenantId: ctx.tenantId, actorId: ctx.userId });
  if (!summary) return null;
  return (
    <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-2 text-xs font-medium text-[var(--accent-text)]">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        <span className="sr-only">Yapay zekâ özeti: </span>
        {summary}
      </span>
    </p>
  );
}
