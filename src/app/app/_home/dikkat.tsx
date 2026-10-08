import { Suspense } from "react";
import { AttentionList } from "@/components/ui/attention-list";
import { InsightCard, InsightSection } from "@/components/ui/insight-card";
import { Skeleton } from "@/components/ui/skeleton";
import { BugunAiOzet } from "./bugun-ozet";
import { loadAttention, type HomeCtx } from "./data";
import { pickBriefing, SEVERITY_LABEL, SEVERITY_TONE, evidenceChips } from "./home-brief";
import { InsightEylemleri } from "./insight-eylem";
import { loadInsightBundle } from "./insight-veri";
import { homeHref, type HomeParams } from "./kapsam-anahtari";

/** İçgörü önizleme sayısı (kart içinde; tamamı "Tüm öneriler" ile açılır). */
const INSIGHT_PREVIEW = 2;
const CONF_LABEL = { dusuk: "düşük güven", orta: "orta güven", yuksek: "yüksek güven" } as const;

export function DikkatIskelet() {
  return (
    <div role="status" aria-busy="true" className="ds-card ds-pad min-h-[22rem]">
      <span className="sr-only">Yükleniyor</span>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-[var(--radius-card)]" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * DİKKAT GEREKTİRENLER (yönetim): geciken tahsilat/görev, onay, riskli anlaşma,
 * bekleyen komisyon, hareketsiz danışman — hepsi gerçek sayım, önem haplı, filtreli hedefe gider (`loadAttention`).
 * Altında içgörü motorunun GERÇEK içgörüleri (`insights` okuyucusu; yoksa bölüm çizilmez, içgörü UYDURULMAZ) ve
 * opsiyonel AI özet satırı. Eski "Karar bekleyenler", "Bugün kuyruğu" ve brifing odak kartı burada birleşti.
 */
export async function Dikkat({ ctx, params }: { ctx: HomeCtx; params: HomeParams }) {
  const [items, bundle] = await Promise.all([loadAttention(ctx), loadInsightBundle(ctx)]);
  const brief = pickBriefing(bundle.insights, bundle.total, INSIGHT_PREVIEW);
  const showAll = params.icgoru === "tum";
  const ordered = brief.focus ? [brief.focus, ...brief.rows] : [];
  const extra = showAll ? bundle.insights.filter((i) => !ordered.some((o) => o.id === i.id)) : [];
  const shown = showAll ? [...ordered, ...extra] : ordered.slice(0, INSIGHT_PREVIEW);
  const canTask = (ctx.perms.tasks ?? []).includes("create");
  const hasMore = brief.total > shown.length || showAll;

  return (
    <AttentionList
      items={items.map((i) => ({ id: i.id, label: i.label, hint: i.hint, href: i.href, level: i.level, count: i.count }))}
      emptyTitle="Şu an dikkat bekleyen iş yok"
      emptyDescription="Geciken görev, onay ya da riskli anlaşma oluşunca burada önem sırasıyla listelenir. İlan sorunları İlan sağlığı bloğundadır."
    >
      <Suspense fallback={null}>
        <BugunAiOzet attention={items} ctx={ctx} />
      </Suspense>
      {shown.length > 0 ? (
        <InsightSection
          allHref={hasMore ? homeHref(params, { icgoru: showAll ? undefined : "tum" }) : undefined}
          allLabel={showAll ? "Daha az göster" : `Tüm öneriler (${brief.total})`}
        >
          <div className="flex flex-col gap-2">
            {shown.map((ins) => (
              <InsightCard
                key={ins.id}
                title={ins.title}
                why={ins.why}
                href={ins.href}
                severity={{ label: SEVERITY_LABEL[ins.severity], tone: SEVERITY_TONE[ins.severity] }}
                forecast={ins.isForecast ? `Tahmin${ins.confidence ? ` · ${CONF_LABEL[ins.confidence]}` : ""}` : null}
                evidence={evidenceChips(ins)}
                actions={<InsightEylemleri id={ins.id} href={ins.href} canTask={canTask} />}
              />
            ))}
          </div>
        </InsightSection>
      ) : null}
    </AttentionList>
  );
}
