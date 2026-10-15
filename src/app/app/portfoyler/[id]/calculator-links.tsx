import Link from "@/components/ui/smart-link";
import { Calculator, HandCoins, LineChart, Wallet } from "lucide-react";

/**
 * Portföyden ön dolgulu hesaplayıcılar (PF-07): satıcının eline geçen, alıcının toplam maliyeti/kredisi ve yatırım
 * getirisi tek dokunuşla bu portföyün fiyatıyla açılır (danışman portföyü yeniden aramaz).
 * Yalnız satılık ve ₺ fiyatlı portföyde anlamlıdır (hesaplayıcılar satılık ve ₺ çalışır); kapı (valuation) çağıranda.
 */
export function PropertyCalculatorLinks({ propertyId, priceTry }: { propertyId: string; priceTry: number }) {
  const links = [
    { href: `/app/hesaplayici?sekme=satici&satis=${Math.round(priceTry)}`, label: "Satıcı net hesabı", hint: "Elinize ne geçer?", icon: HandCoins },
    { href: `/app/hesaplayici?portfoy=${propertyId}`, label: "Alıcı maliyeti ve kredi", hint: "Tapu, masraf, taksit", icon: Wallet },
    { href: `/app/hesaplayici?sekme=yatirim&portfoy=${propertyId}`, label: "Yatırım getirisi", hint: "Kira getirisi, geri dönüş", icon: LineChart },
  ];
  return (
    <section aria-labelledby="hesaplayici-baslik" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <h2 id="hesaplayici-baslik" className="flex items-center gap-2 text-xs font-semibold text-brand-600">
        <Calculator className="h-4 w-4" aria-hidden /> Bu fiyatla hesaplayın
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="focus-ring press flex min-h-11 items-center gap-2.5 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2 transition hover:border-brand-300 hover:bg-brand-600/5"
            >
              <l.icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink-950">{l.label}</span>
                <span className="block text-xs text-text-muted">{l.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
