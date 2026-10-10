import { Lightbulb } from "lucide-react";
import { InsightCard } from "@/components/ui/insight-card";
import { getInsightsForUser } from "@/lib/insights/read";
import type { EffectivePermissions } from "@/lib/permissions-effective";
import { evidenceChips, SEVERITY_LABEL, SEVERITY_TONE, sortInsights } from "@/app/app/_home/home-brief";
import { InsightEylemleri } from "@/app/app/_home/insight-eylem";

const CONF_LABEL = { dusuk: "düşük güven", orta: "orta güven", yuksek: "yüksek güven" } as const;

/**
 * CoachInsightSlot — kişinin KENDİ içgörüleri (TEK okuyucu `getInsightsForUser`: tenant + alıcı = oturumdaki kullanıcı,
 * geçerlilik ve ertelenme kuralları okuyucuda). Satır yoksa (tablo yok, rol içgörü almıyor, örnek veri, yeni ofis)
 * HİÇBİR ŞEY çizilmez: sahte/örnek içgörü üretilmez, boş kutu da bırakılmaz. Ertele/Yoksay/Göreve çevir ana ekranla aynı.
 */
export async function CoachInsightSlot({
  tenantId,
  userId,
  role,
  perms,
  limit = 3,
}: {
  tenantId: string | null;
  userId: string;
  role: string;
  perms: EffectivePermissions;
  limit?: number;
}) {
  if (!tenantId) return null;
  const insights = sortInsights(await getInsightsForUser({ tenantId, userId, role, limit }));
  if (insights.length === 0) return null;
  const canTask = (perms.tasks ?? []).includes("create");
  return (
    <section aria-labelledby="kocluk-baslik" data-slot="coach-insight" className="ds-card ds-pad no-print">
      <header className="ds-head mb-3">
        <span className="pm-ico pm-t-gold" aria-hidden="true">
          <Lightbulb />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="kocluk-baslik" className="ds-title">
            Sıradaki en iyi eylem
          </h2>
          <p className="ds-sub mt-0.5">Verinizden çıkan, kanıtlı gelişim önerileri</p>
        </div>
      </header>
      <div className="flex flex-col gap-2">
        {insights.map((ins) => (
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
    </section>
  );
}
