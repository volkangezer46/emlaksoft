import { formatDateTimeTr } from "@/lib/format";
import { readLatestEfReconciliation } from "@/lib/ef-credits/reconcile-reader";
import { reconTone } from "./viz-model";

const STATUS_LABEL = { ok: "Uyumlu", drift: "Sapma var", error: "Yapılamadı" } as const;
const TONE_CLASS = {
  success: "bg-[color-mix(in_srgb,var(--viz-pos)_16%,transparent)] text-[color:var(--viz-pos)]",
  warn: "bg-[color-mix(in_srgb,var(--viz-5)_18%,transparent)] text-[color:var(--viz-5)]",
  danger: "bg-[color-mix(in_srgb,var(--viz-neg)_16%,transparent)] text-[color:var(--viz-neg)]",
} as const;

function signed(n: number | null): string {
  if (n === null) return "—";
  return n > 0 ? `+${n}` : String(n);
}

/**
 * "Son mutabakat" kartı (salt-okunur, sunucu bileşeni). EmlakFiyati `/kullanim` son 31 gün toplamı ile defter
 * (committed rezervler) karşılaştırması. BAĞLAMA YERİ: /admin/ef-kontor sayfası (veya /admin/sistem EmlakFiyati sekmesi)
 * içinde `<LastReconciliationCard />` olarak yerleştirilir; sayfa kendi `requirePlatformModule` kapısını zaten geçmiştir.
 */
export async function LastReconciliationCard() {
  const last = await readLatestEfReconciliation();
  return (
    <section aria-label="Son mutabakat" className="surface-card rounded-[var(--radius-panel)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-bold text-ink-950">Son mutabakat</h3>
        {last ? (
          <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold ${TONE_CLASS[reconTone(last.status)]}`}>{STATUS_LABEL[last.status]}</span>
        ) : null}
      </div>
      {!last ? (
        <p className="mt-2 text-sm text-text-muted">Henüz mutabakat çalışmadı (günlük 05:10 TR).</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-text-muted">{formatDateTimeTr(last.runAt)}</p>
          <dl className="grid grid-cols-3 gap-x-4 tabular-nums [&>*]:flex [&>*]:h-9 [&>*]:items-center">
            <dt className="text-xs text-text-faint">Kalem</dt>
            <dt className="text-xs text-text-faint">EF / Defter</dt>
            <dt className="text-xs text-text-faint">Fark</dt>
            <dd>Değerleme</dd>
            <dd>{last.efDegerleme ?? "—"} / {last.ledgerDegerleme}</dd>
            <dd className={last.diffDegerleme ? "font-bold text-[color:var(--viz-neg)]" : ""}>{signed(last.diffDegerleme)}</dd>
            <dd>İlk PDF</dd>
            <dd>{last.efPdf ?? "—"} / {last.ledgerPdf}</dd>
            <dd className={last.diffPdf ? "font-bold text-[color:var(--viz-neg)]" : ""}>{signed(last.diffPdf)}</dd>
          </dl>
          <p className="text-xs text-text-faint">Pencere: son 31 gün. Gün sınırı kayması için 2 adet tolerans uygulanır.</p>
        </div>
      )}
    </section>
  );
}
