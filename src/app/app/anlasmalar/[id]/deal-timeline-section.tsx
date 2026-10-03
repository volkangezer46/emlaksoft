import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { countByCategory, filterByCategory } from "@/lib/activity-timeline";
import { createClient } from "@/lib/supabase/server";
import { buildDealEvents, DEAL_TIMELINE_CATEGORIES } from "./deal-events";

/** Anlaşma "Zaman çizelgesi" sekmesi (kategori süzgeci sunucuda: ?kategori=, sayfalama: ?adet=). */
export async function DealTimelineSection({
  deal,
  stageNames,
  showCommission,
  showActors,
  category,
  limit,
}: {
  deal: { id: string; created_at: string; property_id: string | null; customer_id: string | null };
  stageNames: Record<string, string>;
  showCommission: boolean;
  showActors: boolean;
  category: string;
  limit: number;
}) {
  const supabase = await createClient();
  const all = await buildDealEvents(supabase, deal, { stageNames, showCommission, showActors });
  const counts = countByCategory(all);
  const base = `/app/anlasmalar/${deal.id}?sekme=zaman`;
  // Komisyon kategorisi yetkisiz kullanıcıya hiç gösterilmez
  const categories = DEAL_TIMELINE_CATEGORIES.filter((c) => c.key !== "finans" || showCommission).map((c) => ({
    key: c.key,
    label: c.label,
    count: counts[c.key] ?? 0,
  }));
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <ActivityTimeline
        events={filterByCategory(all, category)}
        categories={categories}
        activeCategory={category}
        hrefForCategory={(k) => `${base}${k ? `&kategori=${k}` : ""}`}
        pageSize={limit}
        loadMoreHref={`${base}${category ? `&kategori=${category}` : ""}&adet=${limit + 40}`}
        emptyTitle={category ? "Bu kategoride olay yok." : "Bu anlaşma için henüz olay kaydı yok."}
        emptyHint="Aşama değişimi, not, teklif, belge ve ödeme olayları oluştukça burada günlere göre listelenir."
      />
    </section>
  );
}
