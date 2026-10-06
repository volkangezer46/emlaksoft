import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PlatformInsight } from "@/lib/insights/platform-readable";
import { PlatformInsightEylem } from "./platform-insight-eylem";

const SEVERITY: Record<PlatformInsight["severity"], { label: string; cls: string }> = {
  yuksek: { label: "Yüksek", cls: "text-danger-600" },
  orta: { label: "Orta", cls: "text-amber-700" },
  bilgi: { label: "Bilgi", cls: "text-text-muted" },
};

/** Sıralı platform içgörüleri: önem, neden, kanıt (tıklanabilir ise bağlantı), filtreli href, ertele/yoksay. Veri yoksa HİÇBİR ŞEY çizmez. */
export function PlatformInsightList({ insights }: { insights: PlatformInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="mt-4 border-t border-line pt-3" aria-label="Platform içgörüleri">
      <p className="bx-eyebrow mb-2">Öneriler</p>
      <ul className="flex flex-col gap-3">
        {insights.map((i) => (
          <li key={i.id} className="rounded-[var(--radius-control)] border border-line p-3">
            <div className="flex items-start justify-between gap-3">
              <Link href={i.href} className="focus-ring group min-w-0 flex-1 rounded-[var(--radius-control)]">
                <span className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold ${SEVERITY[i.severity].cls}`}>{SEVERITY[i.severity].label}</span>
                  {i.isForecast ? <span className="text-text-muted">Tahmin{i.confidence ? ` · güven ${i.confidence}` : ""}</span> : null}
                </span>
                <span className="mt-0.5 block text-sm font-medium text-text group-hover:underline">{i.title}</span>
              </Link>
              <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-text-faint" aria-hidden />
            </div>
            <p className="mt-1 text-xs text-text-muted">{i.why}</p>
            {i.evidence.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {i.evidence.slice(0, 4).map((e, idx) => (
                  <li key={idx} className="text-text-muted">
                    {e.label}:{" "}
                    {e.href ? (
                      <Link href={e.href} className="focus-ring font-medium text-accent-text hover:underline">
                        {e.value}
                      </Link>
                    ) : (
                      <span className="font-medium text-text">{e.value}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2">
              <PlatformInsightEylem id={i.id} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
