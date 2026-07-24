import Link from "next/link";
import { Compass, Home, LayoutDashboard, Search } from "lucide-react";

export const metadata = {
  title: "Sayfa bulunamadı",
  robots: { index: false, follow: false },
};

const quickLinks = [
  { href: "/", label: "Ana sayfa", icon: Home },
  { href: "/app", label: "Kontrol paneli", icon: LayoutDashboard },
  { href: "/app/musteriler", label: "Müşteriler", icon: Search },
];

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[image:var(--grad-ink)] px-4 text-white">
      <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/30 blur-[90px]" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-mint-500/20 blur-[90px]" />

      <div className="relative w-full max-w-lg text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[18px] border border-white/12 bg-white/8 backdrop-blur">
          <Compass className="h-8 w-8 text-cyan-400" />
        </div>
        <p className="mt-6 font-display text-7xl font-extrabold tracking-tight text-white/90">404</p>
        <h1 className="mt-2 font-display text-2xl font-extrabold text-white">Sayfa bulunamadı</h1>
        <p className="mt-2 text-sm text-white/60">
          Aradığınız sayfa taşınmış veya hiç var olmamış olabilir. Aşağıdan devam edebilirsiniz.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {quickLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="inline-flex items-center gap-2 rounded-[12px] border border-white/12 bg-white/8 px-5 py-3 text-sm font-semibold text-white transition hover:border-cyan-400/40 hover:bg-white/12"
            >
              <l.icon className="h-4 w-4 text-cyan-400" /> {l.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
