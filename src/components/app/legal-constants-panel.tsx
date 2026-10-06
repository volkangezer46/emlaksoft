import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { LegalDisplay } from "@/lib/legal-constants";

/**
 * Yasal sabit doğrulama rozeti. Doğrulanmamış sabit kullanıcıya HER ZAMAN "Doğrulanmadı" olarak görünür;
 * "Doğrulandı" yalnız durum + doğrulama tarihi birlikte doluysa basılır (`isLegalVerified`).
 */
export function LegalStatusBadge({ item }: { item: Pick<LegalDisplay, "verified" | "verifiedAt" | "source"> }) {
  return item.verified ? (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-mint-400/15 px-2 py-0.5 text-xs font-bold text-mint-700"
      title={`Kaynak: ${item.source}`}
    >
      <ShieldCheck className="h-3 w-3" aria-hidden /> Doğrulandı{item.verifiedAt ? ` · ${item.verifiedAt}` : ""}
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-700"
      title={`Resmî kaynaktan doğrulanmadı. Kaynak iddiası: ${item.source}`}
    >
      <ShieldAlert className="h-3 w-3" aria-hidden /> Doğrulanmadı
    </span>
  );
}

/** Hesapta kullanılan yasal sabitlerin kaynaklı, rozetli listesi. */
export function LegalConstantsPanel({ items, title = "Hesapta kullanılan yasal sabitler" }: { items: LegalDisplay[]; title?: string }) {
  const unverified = items.filter((i) => !i.verified).length;
  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]" aria-label={title}>
      <h3 className="font-display text-sm font-extrabold text-ink-950">{title}</h3>
      <p className="mt-1 text-xs text-text-muted">
        {unverified > 0
          ? `${unverified} sabit resmî kaynaktan doğrulanmadı; sonuçlar bu yüzden yalnız tahmindir.`
          : "Tüm sabitler doğrulama tarihiyle kayıtlı."}{" "}
        Güncelleme yeri tek dosyadır (<code>src/lib/legal-constants</code>).
      </p>
      <ul className="mt-3 divide-y divide-line">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-950">
                {i.label}: <span className="tabular-nums">{i.valueText}</span>
              </p>
              <p className="text-xs text-text-faint">
                Kaynak: {i.source}
                {i.sourceUrl ? (
                  <>
                    {" · "}
                    <a href={i.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-600">
                      bağlantı
                    </a>
                  </>
                ) : null}
              </p>
              {i.note ? <p className="text-xs text-text-faint">{i.note}</p> : null}
            </div>
            <LegalStatusBadge item={i} />
          </li>
        ))}
      </ul>
    </section>
  );
}
