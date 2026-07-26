import Link from "next/link";
import { ArrowRight, BarChart3, Building2, Compass, Home, LayoutDashboard, Users } from "lucide-react";

export const metadata = {
  title: "Sayfa bulunamadı",
  robots: { index: false, follow: false },
};

/** 404'ten sonra en çok gidilen üç yer — kullanıcıyı çıkmaza sokmadan yönlendir. */
const popularLinks = [
  { href: "/app/musteriler", label: "Müşteriler", desc: "CRM kayıtları ve segmentler", icon: Users },
  { href: "/app/portfoyler", label: "Portföyler", desc: "İlanlar, mülkler, eşleştirme", icon: Building2 },
  { href: "/app/raporlar", label: "Raporlar", desc: "Satış ve performans analizi", icon: BarChart3 },
];

export default function NotFound() {
  return (
    <div className="theme-dark relative flex min-h-screen items-center justify-center overflow-hidden bg-[image:var(--grad-ink)] px-4 py-16 text-white">
      {/* Hafif dekor: grid + tek yumuşak glow */}
      <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
      <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-brand-600/30 blur-[110px]" />

      <main className="relative w-full max-w-xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-300">
          <Compass className="h-3.5 w-3.5" /> Hata 404
        </span>

        <p aria-hidden="true" className="text-gradient-static mt-4 select-none font-display text-[96px] font-extrabold leading-none tracking-tight sm:text-[128px]">
          404
        </p>

        <h1 className="mt-3 font-display text-2xl font-extrabold text-white sm:text-3xl">
          Aradığın sayfa taşınmış olabilir
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/60">
          Bağlantı eski olabilir ya da adres yanlış yazılmış olabilir. Sorun değil — aşağıdan
          kaldığın yerden devam edebilirsin.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="btn-shine glow-brand inline-flex items-center gap-2 rounded-[12px] bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Home className="h-4 w-4" /> Ana sayfa
          </Link>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-[12px] border border-white/15 bg-white/8 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:border-cyan-400/40 hover:bg-white/12"
          >
            <LayoutDashboard className="h-4 w-4 text-cyan-300" /> Panele dön
          </Link>
        </div>

        {/* Popüler bağlantılar */}
        <nav aria-label="Popüler bağlantılar" className="mt-12 text-left">
          <p className="text-center text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">
            Popüler bağlantılar
          </p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {popularLinks.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="group flex h-full items-start gap-3 rounded-[14px] border border-white/10 bg-white/[0.05] p-4 backdrop-blur transition hover:border-cyan-400/35 hover:bg-white/10"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-white/10 bg-white/6 text-cyan-300">
                    <l.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-sm font-bold text-white">
                      {l.label}
                      <ArrowRight className="hover-action h-3.5 w-3.5 text-cyan-300 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-white/50">{l.desc}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  );
}
