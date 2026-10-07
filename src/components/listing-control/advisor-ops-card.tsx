import Link from "@/components/ui/smart-link";
import { Suspense } from "react";
import { StatRow } from "@/components/ui/stat-row";
import { SkeletonCard } from "@/components/ui/viz";
import { Panel } from "./ui-parts";
import { CONTROL_BASE, durationLabel, healthyPercent, kpiHref } from "./helpers";
import { getDb, loadAdvisorOpsRow } from "./readers";

/**
 * "İlan operasyon performansı" kartı (danışman detayı + ilan-kontrol). İzole bileşen: danışman sayfası yalnız bunu çağırır.
 * Kapsam RLS'te (görülemeyen danışman için satır gelmez; kart "veri yok" der, sahte sıfır göstermez).
 * Kart ilanları puanlar, kişiyi değil; sayılar filtreli listeye gider.
 */
export function AdvisorListingOpsCard({ advisorId }: { advisorId: string }) {
  return (
    <Suspense fallback={<SkeletonCard height={168} variant="card" label="İlan operasyon performansı yükleniyor" />}>
      <Body advisorId={advisorId} />
    </Suspense>
  );
}

async function Body({ advisorId }: { advisorId: string }) {
  const db = await getDb();
  const res = await loadAdvisorOpsRow(db, advisorId);
  if (!res.available) return null; // şema yok: kart hiç çizilmez (sahte sayı yok)
  if (!res.row || res.row.total_active === 0) {
    return (
      <Panel title="İlan operasyon performansı" description="Portföy ilanlarının portallardaki durumu">
        <p className="text-sm text-text-muted">Bu danışman için ilan kontrol verisi yok (aktif portföy görünmüyor ya da kapsamınız dışında).</p>
      </Panel>
    );
  }
  const r = res.row;
  const g = "danisman" as const;
  const pct = healthyPercent(r);
  return (
    <Panel
      title="İlan operasyon performansı"
      description="Portföy ilanlarının portallardaki durumu"
      action={<Link href={`${CONTROL_BASE}/anomaliler?danisman=${advisorId}`} className="focus-ring rounded text-sm font-semibold text-accent-text hover:underline">Uyarıları gör</Link>}
    >
      <StatRow
        label="İlan operasyon göstergeleri"
        items={[
          { label: "Aktif portföy", value: r.total_active, href: kpiHref("active", g, advisorId) },
          { label: "Portallarda yayınlı", value: r.in_portals, href: kpiHref("in_portals", g, advisorId) },
          { label: "Sorunsuz", value: r.healthy, href: kpiHref("healthy", g, advisorId) },
          { label: "Eksik (yayınlanmamış)", value: r.awaiting_publish, href: kpiHref("awaiting_publish", g, advisorId), attention: true },
          { label: "Portal kayıp", value: r.portal_missing, href: kpiHref("portal_missing", g, advisorId), attention: true },
          { label: "Açıklama bekleyen", value: res.awaitingExplanation, href: `${CONTROL_BASE}/anomaliler?danisman=${advisorId}`, attention: true },
          { label: "Ort. yayına alma süresi", value: durationLabel(res.leadHours), href: kpiHref("awaiting_publish", g, advisorId) },
          { label: "Sağlık", value: pct === null ? "-" : `%${pct}`, href: kpiHref("healthy", g, advisorId) },
        ]}
      />
    </Panel>
  );
}
