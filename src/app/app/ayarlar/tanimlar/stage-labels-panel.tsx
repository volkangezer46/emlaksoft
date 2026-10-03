"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Info, Loader2, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { resetStageLabel, setStageLabel } from "@/app/actions/definitions";
import { defaultStageLabels } from "@/lib/deal-stage-labels";
import { isSystemDefinitionValue } from "@/lib/definition-defaults";
import { DEAL_STAGES } from "@/lib/workflow-state";
import type { DefRow } from "./definitions-manager";

/**
 * "Aşama adları": anlaşma aşamalarının yalnız GÖRÜNEN adı ve rengi. Aşama anahtarları sabittir
 * (komisyon, otomasyon, raporlar bunlara bağlı); bu yüzden aşama eklenemez/silinemez/sıralanamaz.
 */
export function StageLabelsPanel({ items, tenantId }: { items: DefRow[]; tenantId: string | null }) {
  const defaults = defaultStageLabels();
  return (
    <div
      id="definition-panel-deal_stage_label"
      role="tabpanel"
      aria-labelledby="definition-tab-deal_stage_label"
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
    >
      <p className="mb-4 flex items-start gap-2 rounded-[var(--radius-card)] bg-canvas px-3.5 py-3 text-sm text-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        <span>
          Burada yalnız mevcut beş aşamanın <strong className="text-ink-950">adını ve rengini</strong> değiştirirsiniz (ör. “Müzakere” yerine “Pazarlık”).
          Yeni aşama eklenemez; aşamaların sırası ve anlamı (komisyon, otomasyon, raporlar) sabittir. Ad; anlaşma tahtası, detay, arama, raporlar ve otomasyon
          ekranlarında görünür. “Kazanıldı” ve “Kaybedildi” silinemez, yalnız yeniden adlandırılabilir.
        </span>
      </p>
      <div className="space-y-2">
        {DEAL_STAGES.map((stage) => {
          const own = items.find((r) => r.tenant_id === tenantId && r.value === stage) ?? null;
          return (
            <StageRow
              key={`${stage}:${own?.label ?? ""}:${own?.color ?? ""}`}
              stage={stage}
              own={own != null}
              initialLabel={own?.label ?? defaults[stage].label}
              initialColor={own?.color ?? null}
              defaultLabel={defaults[stage].label}
            />
          );
        })}
      </div>
    </div>
  );
}

function StageRow({
  stage,
  own,
  initialLabel,
  initialColor,
  defaultLabel,
}: {
  stage: string;
  own: boolean;
  initialLabel: string;
  initialColor: string | null;
  defaultLabel: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [label, setLabel] = useState(initialLabel);
  const [color, setColor] = useState<string | null>(initialColor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = isSystemDefinitionValue("deal_stage_label", stage);
  const dirty = label.trim() !== initialLabel || (color ?? "").toLowerCase() !== (initialColor ?? "").toLowerCase();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setStageLabel(stage, label, color);
        if (res.error) setError(res.error);
        else {
          push("Aşama adı güncellendi", "ok");
          router.refresh();
        }
      } catch {
        setError("Aşama adı güncellenemedi. Lütfen tekrar deneyin.");
      }
    });
  }
  function reset() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await resetStageLabel(stage);
        if (res.error) setError(res.error);
        else {
          push("Varsayılana dönüldü", "ok");
          router.refresh();
        }
      } catch {
        setError("Varsayılana dönülemedi. Lütfen tekrar deneyin.");
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full border border-line" style={color ? { backgroundColor: color } : undefined} />
        <div className="min-w-[10rem] flex-1">
          <label htmlFor={`stage-${stage}`} className="sr-only">{defaultLabel} aşamasının görünen adı</label>
          <input
            id={`stage-${stage}`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-brand-400"
          />
          <p className="mt-0.5 flex items-center gap-1 text-xs text-text-faint">
            aşama anahtarı: {stage}
            {locked ? <span className="inline-flex items-center gap-0.5" title="Silinemez; yalnız adı ve rengi değişir"><ShieldCheck className="h-3 w-3" /> kilitli</span> : null}
          </p>
        </div>
        <input
          type="color"
          aria-label={`${label} rengi`}
          value={color ?? "#6366f1"}
          onChange={(e) => setColor(e.target.value)}
          className="h-7 w-7 min-h-9 min-w-9 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-line bg-canvas p-1"
        />
        {color ? (
          <button type="button" onClick={() => setColor(null)} aria-label="Rengi kaldır" className="grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-canvas hover:text-ink-950">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty || !label.trim()}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Kaydet
        </button>
        {own ? (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-xs font-semibold text-text-muted transition hover:border-amber-400 hover:text-amber-600 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Sıfırla
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger-500">{error}</p> : null}
    </div>
  );
}
