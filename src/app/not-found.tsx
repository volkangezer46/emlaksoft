import Link from "next/link";
import { ArrowRight, BarChart3, Building2, Compass, Home, LogIn, Sparkles } from "lucide-react";

// Robots: Next 404 yanıtına kendi `noindex` meta'sını ekler; burada ikinci bir robots etiketi YAZILMAZ (çift meta olmasın).
export const metadata = {
  title: "Sayfa bulunamadı",
};

/**
 * 404'ten sonra en çok gidilen yerler. Oturum denetimi (önbelleksiz kimlik turu) 404'e eklenmez:
 * herkese açık, hafif bağlantılar gösterilir; oturumu olan kullanıcı "Giriş yap" ile panele geçer.
 */
const popularLinks = [
  { href: "/fiyatlar", label: "Fiyatlar", desc: "Paketler ve kapsam", icon: BarChart3 },
  { href: "/kayit", label: "Ücretsiz deneyin", desc: "Ofisinizi birkaç dakikada açın", icon: Sparkles },
  { href: "/araclar", label: "Araçlar", desc: "Ücretsiz hesaplayıcılar", icon: Building2 },
];

const btn =
  "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] border border-white/15 bg-white/8 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:border-cyan-400/40 hover:bg-white/12";

export default function NotFound() {
  return (
    <div className="theme-dark relative flex min-h-screen items-center justify-center overflow-hidden bg-[image:var(--grad-ink)] px-4 py-16 text-white">
      <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
      <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-brand-600/30 blur-[110px]" />

      <main id="main-content" className="relative w-full max-w-xl text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-cyan-300">
          <Compass aria-hidden className="h-3.5 w-3.5" /> Hata 404
        </span>

        <p aria-hidden="true" className="text-gradient-static mt-4 select-none font-display text-[96px] font-extrabold leading-none tracking-tight sm:text-[128px]">
          404
        </p>

        <h1 className="mt-3 font-display text-2xl font-extrabold text-white sm:text-3xl">
          Aradığınız sayfa taşınmış olabilir
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/70">
          Bağlantı eski olabilir ya da adres yanlış yazılmış olabilir. Sorun değil, aşağıdan
          kaldığınız yerden devam edebilirsiniz.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="btn-shine glow-brand inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Home aria-hidden className="h-4 w-4" /> Ana sayfa
          </Link>
          <Link href="/giris" className={btn}>
            <LogIn aria-hidden className="h-4 w-4 text-cyan-300" /> Giriş yapın
          </Link>
        </div>

        <nav aria-label="Popüler bağlantılar" className="mt-12 text-left">
          <p className="text-center text-xs font-bold uppercase tracking-[0.14em] text-white/60">Popüler bağlantılar</p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {popularLinks.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="group flex h-full min-h-11 items-start gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.05] p-4 backdrop-blur transition hover:border-cyan-400/35 hover:bg-white/10"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-white/10 bg-white/6 text-cyan-300">
                    <l.icon aria-hidden className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-sm font-bold text-white">
                      {l.label}
                      <ArrowRight aria-hidden className="hover-action h-3.5 w-3.5 text-cyan-300 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-white/60">{l.desc}</span>
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
