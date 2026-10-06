import Link from "next/link";
import { Bell, PhoneIncoming } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { Widget } from "../dashboard-widgets";

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
