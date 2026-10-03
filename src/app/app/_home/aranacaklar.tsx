import Link from "next/link";
import { ArrowUpRight, Phone } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Widget } from "../dashboard-widgets";
import { loadHotLeads, type HomeCtx } from "./data";
import { PanelLink } from "./ortak";

const LIST_MAX = 5;

/**
 * "Bugün aranacaklar" — danışmanın kendi sıcak müşterileri (customer_lead_signals + lead skoru),
 * puana göre. Her satır müşteri kaydına gider; telefon varsa tek dokunuşla aranır.
 */
export async function Aranacaklar({ ctx }: { ctx: HomeCtx }) {
  const hot = await loadHotLeads(ctx);
  const rows = hot.slice(0, LIST_MAX);
  return (
    <Widget id="aranacaklar" className="h-full">
      <section className="pm-bx h-full p-5" aria-labelledby="aranacaklar-baslik">
        <div className="flex items-center justify-between gap-2">
          <h2 id="aranacaklar-baslik" className="font-display font-bold text-ink-950">
            Bugün aranacaklar
          </h2>
          <span className="flex items-center gap-2">
            {hot.length > 0 ? (
              <Link
                href="/app/musteriler?sort=hot"
                className="focus-ring rounded-full bg-mint-500/12 px-2 py-0.5 text-xs font-semibold text-mint-700"
                title="Sıcak müşterileri aç"
              >
                {hot.length}
              </Link>
            ) : null}
            <PanelLink href="/app/akilli-listeler">
              Akıllı listeler <ArrowUpRight className="h-3.5 w-3.5" />
            </PanelLink>
          </span>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            variant="compact"
            illustration="arama"
            tone="mint"
            title="Dönüş bekleyen sıcak müşteri yok"
            description="Yeni arama ve görüşme kayıtları geldikçe sıcak müşteriler burada çıkar."
            action={{ href: "/app/hizli?sekme=musteri", label: "Müşteri ekle" }}
          />
        ) : (
          <ul className="mt-4 space-y-2.5">
            {rows.map((c) => (
              <li key={c.id} className="group relative">
                <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 transition group-hover:border-brand-300 group-hover:bg-surface">
                  <Link
                    href={`/app/musteriler/${c.id}`}
                    className="focus-ring absolute inset-0 z-0 rounded-[var(--radius-card)]"
                    aria-label={`${c.fullName} müşteri kaydı`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-950">{c.fullName}</span>
                    <span className="block text-xs text-text-muted">{c.phone ?? "Telefon kaydı yok"}</span>
                  </span>
                  {c.phone && !ctx.tvMode ? (
                    <a
                      href={`tel:${c.phone}`}
                      title="Müşteriyi ara"
                      aria-label={`${c.fullName} ara`}
                      className="focus-ring press relative z-10 grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-mint-600 transition hover:border-mint-500/50 hover:bg-mint-500/10"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Widget>
  );
}
