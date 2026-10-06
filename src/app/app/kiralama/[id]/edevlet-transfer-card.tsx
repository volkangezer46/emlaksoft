import { ExternalLink, Landmark } from "lucide-react";
import { CopyTextButton } from "@/components/app/copy-text-button";
import {
  EDEVLET_GUIDE_LABEL,
  EDEVLET_GUIDE_URL,
  buildEdevletCopyText,
  buildEdevletFields,
  type EdevletRentalInput,
} from "@/lib/rental-contract/edevlet-summary";

/** Kira sözleşmesi sekmesi: e-Devlet Dijital Kontrat formuna elle aktarım için alan özeti + tek tık kopyala. */
export function EdevletTransferCard({ input }: { input: EdevletRentalInput }) {
  const fields = buildEdevletFields(input);
  return (
    <section aria-labelledby="edevlet-baslik" className="space-y-3 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="edevlet-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
          <Landmark className="h-4 w-4 text-brand-600" aria-hidden /> e-Devlet kira sözleşmesine aktarım
        </h2>
        <CopyTextButton text={buildEdevletCopyText(input)} label="e-Devlet alanlarını kopyala" doneMessage="Alanlar panoya kopyalandı" />
      </div>
      <p className="text-xs text-text-muted">
        e-Devlet&apos;teki &quot;Dijital Kontrat – Kira Sözleşmesi&quot; hizmetini kullanacaksanız sıkça istenen bilgiler aşağıdadır. EmlakSoft
        e-Devlet&apos;e veri göndermez; formu taraflar kendi e-Devlet hesaplarından tamamlar.
      </p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-xs font-semibold text-text-muted">{f.label}</dt>
            <dd className="truncate text-sm text-ink-950">{f.value}</dd>
          </div>
        ))}
      </dl>
      <a
        href={EDEVLET_GUIDE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
      >
        {EDEVLET_GUIDE_LABEL} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    </section>
  );
}
