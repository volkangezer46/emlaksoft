import { formatDateTimeTr } from "@/lib/format";
import { readLatestEfReconciliation } from "@/lib/ef-credits/reconcile-reader";

const STATUS_LABEL = { ok: "Uyumlu", drift: "Sapma var", error: "Yapılamadı" } as const;

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
    <section aria-label="Son mutabakat" className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Son mutabakat</h3>
      {!last ? (
        <p className="mt-2 text-sm text-muted-foreground">Henüz mutabakat çalışmadı (günlük 05:10 TR).</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <p>
            <span className="font-medium">{STATUS_LABEL[last.status]}</span>
            <span className="text-muted-foreground"> · {formatDateTimeTr(last.runAt)}</span>
          </p>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-1 tabular-nums">
            <dt className="text-muted-foreground">Kalem</dt>
            <dt className="text-muted-foreground">EF / Defter</dt>
            <dt className="text-muted-foreground">Fark</dt>
            <dd>Değerleme</dd>
            <dd>{last.efDegerleme ?? "—"} / {last.ledgerDegerleme}</dd>
            <dd>{signed(last.diffDegerleme)}</dd>
            <dd>İlk PDF</dd>
            <dd>{last.efPdf ?? "—"} / {last.ledgerPdf}</dd>
            <dd>{signed(last.diffPdf)}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">Pencere: son 31 gün. Gün sınırı kayması için 2 adet tolerans uygulanır.</p>
        </div>
      )}
    </section>
  );
}
