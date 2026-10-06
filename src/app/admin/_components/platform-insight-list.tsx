import type { PlatformInsight } from "@/lib/insights/platform-readable";
import { InsightCard, InsightSection } from "@/components/ui/insight-card";
import { PlatformInsightEylem } from "./platform-insight-eylem";

const SEVERITY: Record<PlatformInsight["severity"], { label: string; tone: "danger" | "warn" | "neutral" }> = {
  yuksek: { label: "Yüksek", tone: "danger" },
  orta: { label: "Orta", tone: "warn" },
  bilgi: { label: "Bilgi", tone: "neutral" },
};

/**
 * Sıralı platform içgörüleri ("Öneriler"): önem, neden, kanıt (tıklanabilir ise bağlantı), filtreli
 * href, ertele/yoksay. Tek kart dili `InsightCard`. Veri yoksa HİÇBİR ŞEY çizmez (içgörü uydurulmaz).
 */
export function PlatformInsightList({ insights }: { insights: PlatformInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <InsightSection>
      {insights.map((i) => (
        <InsightCard
          key={i.id}
          title={i.title}
          why={i.why}
          href={i.href}
          severity={SEVERITY[i.severity]}
          forecast={i.isForecast ? `Tahmin${i.confidence ? ` · güven ${i.confidence}` : ""}` : null}
          evidence={i.evidence.map((e) => ({ label: e.label, value: String(e.value), href: e.href ?? null }))}
          actions={<PlatformInsightEylem id={i.id} />}
        />
      ))}
    </InsightSection>
  );
}
