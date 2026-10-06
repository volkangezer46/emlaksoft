import Link from "next/link";
import { Landmark } from "lucide-react";
import { GOS_CHECKLIST_ITEMS, GOS_DATE_NOTE, GOS_NO_MONEY_NOTE, GOS_SOURCES, GOS_SUMMARY } from "@/lib/gos-info";

/**
 * Güvenli Ödeme Sistemi (GÖS) bilgi kartı — kaynaklı ve dürüst: tarih kaynaklarda farklıdır, para üründen geçmez.
 * Metinler tek kaynak `src/lib/gos-info.ts`; kapanış listesi ve yabancıya satış listesi aynı maddeleri taşır.
 */
export function GosCard() {
  return (
    <section
      id="gos"
      aria-labelledby="gos-baslik"
      className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]"
    >
      <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
        <Landmark className="h-4 w-4" aria-hidden /> Taşınmaz satışında yeni dönem
      </p>
      <h2 id="gos-baslik" className="mt-1 font-display font-bold text-ink-950">
        Güvenli Ödeme Sistemi (GÖS) hazırlığı
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{GOS_SUMMARY}</p>

      <p className="mt-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/[0.07] px-3 py-2 text-xs leading-relaxed text-text-muted">
        <span className="font-bold text-amber-700">Tarih uyarısı: </span>
        {GOS_DATE_NOTE}
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Satış kapanış listesine eklenen adımlar</h3>
          <ul className="mt-2 space-y-1.5 text-xs text-text-muted">
            {GOS_CHECKLIST_ITEMS.map((i) => (
              <li key={i.label} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
                {i.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
            <Link href="/app/anlasmalar" className="focus-ring text-brand-600 underline-offset-2 hover:underline">
              Anlaşmalarda uygula →
            </Link>
            <Link href="/app/yabanci-satis" className="focus-ring text-brand-600 underline-offset-2 hover:underline">
              Yabancıya satış listesi →
            </Link>
            <Link href="/app/sozlesmeler/yeni?tur=satis" className="focus-ring text-brand-600 underline-offset-2 hover:underline">
              Sözleşmeye isteğe bağlı GÖS maddesi →
            </Link>
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink-950">Kaynaklar (ikincil; resmî metin doğrulanmadı)</h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {GOS_SOURCES.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring break-words text-brand-600 underline-offset-2 hover:underline"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-text-faint">{GOS_NO_MONEY_NOTE}</p>
    </section>
  );
}
