import { ActivityTimeline } from "@/components/ui/activity-timeline";
import { countByCategory, filterByCategory } from "@/lib/activity-timeline";
import { createClient } from "@/lib/supabase/server";
import { buildPropertyEvents, PROPERTY_TIMELINE_CATEGORIES } from "./property-events";

/**
 * Portföy "Zaman çizelgesi" sekmesi — fiyat, durum, gösterim, randevu, teklif,
 * anlaşma, portal, anahtar ve medya olayları tek akışta. Kategori süzgeci
 * sunucuda (`?kategori=`), sayfalama `?adet=` ile.
 */
export async function PropertyTimelineSection({
  propertyId,
  stageNames,
  category,
  limit,
}: {
  propertyId: string;
  stageNames: Record<string, string>;
  category: string;
  limit: number;
}) {
  const supabase = await createClient();
  const all = await buildPropertyEvents(supabase, propertyId, stageNames);
  const counts = countByCategory(all);
  const base = `/app/portfoyler/${propertyId}?sekme=zaman`;
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <ActivityTimeline
        events={filterByCategory(all, category)}
        categories={PROPERTY_TIMELINE_CATEGORIES.map((c) => ({ key: c.key, label: c.label, count: counts[c.key] ?? 0 }))}
        activeCategory={category}
        hrefForCategory={(k) => `${base}${k ? `&kategori=${k}` : ""}`}
        pageSize={limit}
        loadMoreHref={`${base}${category ? `&kategori=${category}` : ""}&adet=${limit + 40}`}
        emptyTitle={category ? "Bu kategoride olay yok." : "Bu portföy için henüz olay kaydı yok."}
        emptyHint="Fiyat değişimi, randevu, teklif ve portal yayını oluştukça burada günlere göre listelenir."
      />
    </section>
  );
}
