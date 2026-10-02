import Link from "next/link";
import { ArrowUpRight, Bell, PhoneIncoming, Plus } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { Widget } from "../dashboard-widgets";
import { loadLatestCustomers } from "./data";
import { initials } from "./helpers";
import { PanelLink } from "./ortak";

const quickTile =
  "focus-ring group flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-4 transition hover:border-brand-300 hover:bg-surface";

/** Hızlı aksiyonlar — veri çekmez, anında render edilir. */
export function HizliAksiyonlar() {
  return (
    <Widget id="hizli" className="h-full">
      <section className="surface-card h-full rounded-[var(--radius-panel)] p-5">
        <h2 className="font-display font-bold text-ink-950">Hızlı aksiyonlar</h2>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/app/musteriler" className={quickTile}>
            <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
              <ICONS.musteri className="h-5 w-5" />
            </div>
            <span className="text-xs font-semibold text-ink-950">Müşteri</span>
          </Link>
          <Link href="/app/portfoyler" className={quickTile}>
            <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-mint-500/10 text-mint-600 transition group-hover:bg-mint-500 group-hover:text-white">
              <ICONS.portfoy className="h-5 w-5" />
            </div>
            <span className="text-xs font-semibold text-ink-950">Portföy</span>
          </Link>
          <Link href="/app/arama" className={quickTile}>
            <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-cyan-500/10 text-cyan-600 transition group-hover:bg-cyan-500 group-hover:text-white">
              <PhoneIncoming className="h-5 w-5" />
            </div>
            <span className="text-xs font-semibold text-ink-950">Arama</span>
          </Link>
          <Link href="/app/randevular" className={quickTile}>
            <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-control)] bg-amber-400/10 text-amber-600 transition group-hover:bg-amber-400 group-hover:text-white">
              <Bell className="h-5 w-5" />
            </div>
            <span className="text-xs font-semibold text-ink-950">Randevu</span>
          </Link>
        </div>
      </section>
    </Widget>
  );
}

export async function SonMusteriler() {
  const latest = await loadLatestCustomers();

  return (
    <Widget id="musteriler" className="h-full">
      <section className="surface-card h-full rounded-[var(--radius-panel)] p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-ink-950">Son müşteriler</h2>
          <PanelLink href="/app/musteriler">
            Tümü <ArrowUpRight className="h-3.5 w-3.5" />
          </PanelLink>
        </div>
        {latest.length > 0 ? (
          <ul className="mt-4 space-y-2.5">
            {latest.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/musteriler/${c.id}`}
                  className="focus-ring group flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-800 text-xs font-bold text-white">
                    {initials(c.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-950">{c.full_name}</span>
                    <span className="block text-xs text-text-muted">
                      {c.customer_types && c.customer_types.length > 0 ? c.customer_types[0] : "—"}
                    </span>
                  </span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line-strong px-3 py-8 text-center">
            <p className="text-sm text-text-muted">Henüz müşteri yok</p>
            <Link href="/app/musteriler" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600">
              <Plus className="h-4 w-4" /> İlk müşteriyi ekle
            </Link>
          </div>
        )}
      </section>
    </Widget>
  );
}
