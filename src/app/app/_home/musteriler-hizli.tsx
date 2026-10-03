import Link from "next/link";
import { ArrowUpRight, Bell, PhoneIncoming, Plus } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { Widget } from "../dashboard-widgets";
import { loadLatestCustomers } from "./data";
import { initials } from "./helpers";
import { PanelLink } from "./ortak";

const chip =
  "focus-ring press group inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3.5 py-2 text-sm font-semibold text-[var(--text)] transition hover:border-[var(--hairline-strong)] hover:text-[var(--accent-text)]";

/** Hızlı eylem çubuğu — veri çekmez, anında render edilir; komut paleti ipucunu taşır. */
export function HizliAksiyonlar() {
  const actions = [
    { href: "/app/hizli?sekme=musteri", label: "Yeni müşteri", Icon: ICONS.musteri },
    { href: "/app/portfoyler/yeni", label: "Yeni portföy", Icon: ICONS.portfoy },
    { href: "/app/hizli?sekme=gorusme", label: "Arama kaydı", Icon: PhoneIncoming },
    { href: "/app/hizli?sekme=randevu", label: "Randevu planla", Icon: Bell },
  ];
  return (
    <Widget id="hizli" className="h-full">
      <section className="pm-bx flex flex-wrap items-center gap-2 p-3 md:p-4" aria-label="Hızlı eylemler">
        <span className="pm-bx-eyebrow mr-1 px-2">Hızlı eylem</span>
        {actions.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={chip}>
            <Icon className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
            {label}
          </Link>
        ))}
        <span className="ml-auto hidden items-center gap-2 text-xs text-[var(--text-muted)] md:inline-flex">
          Her şeyi aramak için
          <kbd className="rounded-md border border-[var(--hairline-strong)] bg-[var(--surface-sunken,transparent)] px-1.5 py-0.5 font-mono text-xs">Ctrl K</kbd>
        </span>
      </section>
    </Widget>
  );
}

export async function SonMusteriler() {
  const latest = await loadLatestCustomers();

  return (
    <Widget id="musteriler" className="h-full">
      <section className="pm-bx h-full p-5">
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
