import Link from "@/components/ui/smart-link";
import { Phone } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { loadHotLeads, type HomeCtx } from "./data";
import { buildCallRows } from "./home-brief";
import { loadInsightBundle } from "./insight-veri";

const CARD_MIN = "min-h-[16rem]";

export function DanismanAraIskelet() {
  return (
    <div role="status" aria-busy="true" className={`pm-c1 ${CARD_MIN} p-4`}>
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-3 w-28" />
      <div className="mt-3 space-y-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * "BUGÜN ARA" tablosu — skor yerine GEREKÇE: ad, neden etiketleri, ara düğmesi.
 * Nedenler: call_priority içgörüsünün kanıtları (sessizlik süresi, açık talep…) + lead-skoru bileşenleri
 * ("Açık talep", "Randevu", "Teklif verdi"…). Satır müşteri kaydına, düğme tel: bağlantısına gider (tek eylem).
 */
export async function DanismanAra({ ctx }: { ctx: HomeCtx }) {
  const [hot, bundle] = await Promise.all([loadHotLeads(ctx), loadInsightBundle(ctx)]);
  const rows = buildCallRows(
    hot.map((h) => ({ id: h.id, fullName: h.fullName, phone: h.phone, reasons: h.reasons })),
    bundle.insights,
    6,
  );

  return (
    <section aria-labelledby="ara-baslik" className={`pm-c1 ${CARD_MIN} flex h-full flex-col p-4`}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="ara-baslik" className="pm-bx-eyebrow">
          Bugün ara
        </h2>
        <Link href="/app/akilli-listeler" className="focus-ring rounded-[var(--radius-control)] px-1 text-xs font-semibold text-[var(--accent-text)]">
          Akıllı listeler
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="arama"
          tone="mint"
          title="Bugün aranacak sıcak müşteri yok"
          description="Yeni arama ve görüşme kayıtları geldikçe aranacaklar nedenleriyle burada listelenir."
          action={{ href: "/app/hizli?sekme=musteri", label: "Müşteri ekle" }}
        />
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="pm-tbl">
            <caption className="sr-only">Bugün aranacak müşteriler ve nedenleri</caption>
            <thead>
              <tr>
                <th scope="col">Müşteri</th>
                <th scope="col" className="pm-l">Neden</th>
                <th scope="col">
                  <span className="sr-only">Ara</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    <Link href={r.href} className="focus-ring rounded-sm" title={r.name}>
                      {r.name}
                    </Link>
                  </th>
                  <td className="pm-l pm-wrap">
                    <ul className="flex flex-wrap gap-1">
                      {r.reasons.map((reason) => (
                        <li key={reason} className="rounded-full border border-line bg-[var(--surface-sunken)] px-2 py-0.5 text-xs text-text-muted">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    {r.phone && !ctx.tvMode ? (
                      <a
                        href={`tel:${r.phone}`}
                        aria-label={`${r.name} ara`}
                        title="Müşteriyi ara"
                        className="focus-ring press inline-grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-[var(--pm-success-text)] transition hover:bg-[var(--surface-hover)]"
                      >
                        <Phone className="h-4 w-4" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-text-faint" title="Telefon kaydı yok">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
