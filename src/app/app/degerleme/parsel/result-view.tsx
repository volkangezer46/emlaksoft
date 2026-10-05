import Link from "next/link";
import { FileDown, FileText, ShieldAlert } from "lucide-react";
import type { OrtakValuationOk } from "@/lib/integrations/emlakfiyati/ortak-contract";
import { presentValuation, type EfLine } from "@/lib/ef-credits/present";
import { formatDateTr } from "@/lib/format";

function Lines({ title, lines }: { title: string; lines: EfLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-faint">{title}</h4>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {lines.map((l, i) => (
          <div key={`${l.label}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1.5 text-sm">
            <dt className="text-text-muted">{l.label}</dt>
            <dd className="numeric text-right font-semibold text-ink-950">{l.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * K10 sonuç görünümü (sunucu/istemci güvenli, durumsuz). Düşük güvende kesin TL YOK: yalnız `guven_sunumu`.
 * "Kesin değer/garanti" dili yok; ilan fiyatı notu her zaman görünür.
 */
export function EfResultView({ result, raporId, showActions = true }: { result: OrtakValuationOk; raporId: string | null; showActions?: boolean }) {
  const v = presentValuation(result);
  return (
    <article className="space-y-5" aria-label="Ada/parsel değerleme sonucu">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${v.dusukGuven ? "bg-danger-500/10 text-danger-600" : "bg-mint-500/10 text-mint-700"}`}>
          {v.guvenEtiketi}
        </span>
        {v.expiresAt ? (
          <span className="rounded-full bg-ink-950/6 px-3 py-1 text-xs font-semibold text-text-muted">
            Rapor geçerlilik: {formatDateTr(v.expiresAt)}
            {v.gecerlilikGun ? ` (${v.gecerlilikGun} gün)` : ""}
          </span>
        ) : null}
      </div>

      {v.baslik ? (
        <div role="note" className="rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/8 p-4">
          <p className="flex items-center gap-2 font-display text-lg font-extrabold text-danger-600">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" /> {v.baslik}
          </p>
          <p className="mt-1 text-sm text-text-muted">Bu sonuçta tek bir kesin tutar veya TL/m² verilmez; aşağıdaki yuvarlak aralık ve açıklama geçerlidir.</p>
        </div>
      ) : null}

      {v.sunumSatirlari.length > 0 || v.sunumMetinleri.length > 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-4">
          <h4 className="text-xs font-bold uppercase tracking-[0.08em] text-text-faint">Güven sunumu</h4>
          {v.sunumSatirlari.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {v.sunumSatirlari.map((l, i) => (
                <li key={`${l.label}-${i}`} className="flex justify-between gap-3 text-sm">
                  <span className="text-text-muted">{l.label}</span>
                  <span className="numeric font-bold text-ink-950">{l.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {v.sunumMetinleri.map((t, i) => (
            <p key={i} className="mt-2 text-sm text-ink-950">{t}</p>
          ))}
        </div>
      ) : null}

      <Lines title="Parsel" lines={v.parsel} />
      <Lines title={v.dusukGuven ? "Değerleme verisi (kesin TL yok)" : "Değerleme"} lines={v.tahmin} />
      <Lines title="Emsaller" lines={v.emsal} />
      <Lines title="Konut özellikleri" lines={v.konut} />

      <ul className="space-y-1 rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/8 px-4 py-3 text-sm text-amber-800">
        {v.notlar.map((n) => (
          <li key={n}>{n}</li>
        ))}
        <li>Bu çıktı bir piyasa göstergesidir; ekspertiz veya resmi değerleme yerine geçmez.</li>
      </ul>

      {showActions && raporId ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/app/degerleme/parsel/rapor/${raporId}`}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink-950 hover:border-brand-300"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Rapor detayı
          </Link>
          <a
            href={`/api/app/ef-rapor/${raporId}/pdf`}
            className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-ink-950 px-3.5 py-2 text-xs font-semibold text-white"
          >
            <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> PDF indir
          </a>
        </div>
      ) : null}
    </article>
  );
}
