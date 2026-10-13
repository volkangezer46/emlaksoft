import { SoftLink as Link } from "@/components/ui/soft-link";
import { ArrowRight, BarChart3, Building2, Compass, Home, LogIn, Sparkles, type LucideIcon } from "lucide-react";
import { defaultSiteMenu } from "@/lib/site-menu/defaults";
import type { NotFoundContent } from "@/lib/site-menu/schema";
import { checkPageHref } from "@/lib/site-menu/schema-core";
import { getLiveSiteMenu } from "@/lib/site-menu/store";

// Robots: Next 404 yanıtına kendi `noindex` meta'sını ekler; burada ikinci bir robots etiketi YAZILMAZ (çift meta olmasın).
export const metadata = {
  title: "Sayfa bulunamadı",
};

/** Bağlantı ikonu hedefe göre seçilir (yönetimden yalnız metin ve hedef gelir); bilinmeyen hedefte pusula. */
function iconFor(href: string): LucideIcon {
  const path = href.split(/[?#]/)[0];
  if (path === "/fiyatlar") return BarChart3;
  if (path === "/kayit") return Sparkles;
  if (path === "/araclar" || path.startsWith("/araclar/")) return Building2;
  return Compass;
}

/**
 * 404 metni ve popüler bağlantılar yönetimden (Site menüsü > 404 sayfası; yayın yoksa bugünkü metin). Okunamazsa
 * varsayılan kullanılır. Oturum denetimi (önbelleksiz kimlik turu) 404'e eklenmez: herkese açık, hafif bağlantılar
 * gösterilir; oturumu olan kullanıcı "Giriş yap" ile panele geçer.
 */
async function loadContent(): Promise<NotFoundContent> {
  try {
    return (await getLiveSiteMenu()).notFound;
  } catch {
    return defaultSiteMenu().notFound;
  }
}

const btn =
  "inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] border border-white/15 bg-white/8 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:border-cyan-400/40 hover:bg-white/12";

export default async function NotFound() {
  const content = await loadContent();
  const popularLinks = content.links
    .filter((l) => l.label && checkPageHref(l.href).ok)
    .map((l) => ({ href: l.href, label: l.label, desc: l.desc, icon: iconFor(l.href) }));
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
          {content.title}
        </h1>
        {content.text ? (
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/70">
            {content.text}
          </p>
        ) : null}

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

        {popularLinks.length ? (
        <nav aria-label="Popüler bağlantılar" className="mt-12 text-left">
          <p className="text-center text-xs font-bold uppercase tracking-[0.14em] text-white/60">Popüler bağlantılar</p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-3">
            {popularLinks.map((l, i) => (
              <li key={i}>
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
                    {l.desc ? <span className="mt-0.5 block text-xs leading-relaxed text-white/60">{l.desc}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        ) : null}
      </main>
    </div>
  );
}
