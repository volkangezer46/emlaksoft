import Link from "next/link";
import { Building2, ShieldCheck, Sparkles, TrendingUp, Wallet } from "lucide-react";

/**
 * Kurumsal split-screen auth kabuğu — solda marka paneli (koyu, aurora, güven
 * sinyalleri), sağda form alanı. Giriş ve kayıt aynı premium kabuğu paylaşır.
 */
export function AuthShell({
  children,
  panelTitle,
  panelDesc,
}: {
  children: React.ReactNode;
  panelTitle: string;
  panelDesc: string;
}) {
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_1fr]">
      {/* Sol: marka paneli */}
      <aside className="theme-dark relative hidden overflow-hidden bg-[image:var(--grad-ink)] text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -left-24 top-[-10%] h-[420px] w-[420px] rounded-full bg-brand-600/35 blur-[100px]" />
        <div className="pointer-events-none absolute -right-16 bottom-[-8%] h-[360px] w-[360px] rounded-full bg-cyan-400/20 blur-[90px]" />

        <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-14">
          <Link href="/" className="font-display text-xl font-extrabold text-white">
            EmlakSoft
          </Link>

          <div className="max-w-md">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" /> Türkiye&apos;nin emlak işletim sistemi
            </span>
            <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight xl:text-4xl">{panelTitle}</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/65">{panelDesc}</p>

            <ul className="mt-8 space-y-3.5">
              {[
                { icon: Building2, text: "Portföy, müşteri ve randevu — tek panelde" },
                { icon: Wallet, text: "Komisyon ve kayıp-kaçak takibi otomatik" },
                { icon: TrendingUp, text: "Portal ilanları ve dönüşüm raporları canlı" },
                { icon: ShieldCheck, text: "İYS · EİDS · KVKK uyumu hazır" },
              ].map((f) => (
                <li key={f.text} className="flex items-center gap-3 text-sm text-white/80">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] border border-white/10 bg-white/6 text-cyan-300">
                    <f.icon className="h-4 w-4" />
                  </span>
                  {f.text}
                </li>
              ))}
            </ul>
          </div>

          <figure className="max-w-md rounded-[18px] border border-white/10 bg-white/[0.05] p-5 backdrop-blur">
            <blockquote className="text-sm leading-relaxed text-white/80">
              &quot;Portal kapanışlarından kaçan komisyonu ilk ay gördük. Artık hangi ilanın nerede kapandığı ve
              kimin araması gerektiği net.&quot;
            </blockquote>
            <figcaption className="mt-3 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">SD</span>
              <div>
                <p className="text-sm font-bold text-white">Serkan D.</p>
                <p className="text-[11px] text-white/50">Ofis sahibi · İzmir</p>
              </div>
            </figcaption>
          </figure>
        </div>
      </aside>

      {/* Sağ: form alanı */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <Link href="/" className="font-display text-lg font-extrabold text-ink-950 lg:hidden">
            EmlakSoft
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
