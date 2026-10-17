import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ZekaDock } from "@/components/zeka/zeka-panel";
import { zekaSurfaceEnabled } from "@/lib/ai/zeka/settings";
import { parseSorParams, type SorSearchParams } from "@/lib/ai/zeka/sor-params";
import { getSupportContact } from "@/lib/contact-info-server";
import { buildMetadata } from "@/lib/seo/store";
import "@/app/marketing.css";
import "@/app/marketing-sections.css";

/**
 * /sor — "EmlakSoft'a sor" tam sayfa sohbeti (public Zeka). Statik ana sayfa Next betiği taşımadığından kahraman soru
 * kutusu (GET `?q=`) ve yüzen "Zeka'ya sor" bağlantısı (`?from=<yol>`) hidrasyon olmadan buraya gelir.
 *  - Sohbet AYNI pencere bileşenidir (`ZekaDock`, `layout="page"`); ikinci bir sohbet uygulaması yoktur.
 *  - searchParams SUNUCUDA okunur ve prop olarak geçer (istemcide useSearchParams yok); `?q` açılışta bir kez sorulur,
 *    `?from` sayfa bağlamıdır (başlangıç soruları + sunucu bağlamı). Sorgu dizesi varsa noindex; kanonik buildMetadata'da.
 *  - Bu sayfada yüzen düğme basılmaz (`SiteFooter zeka={false}`). Yüzey yönetimden kapalıysa nazik not + iletişim.
 */
type Props = { searchParams: Promise<SorSearchParams> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { hasQuery } = parseSorParams(await searchParams);
  return buildMetadata("/sor", hasQuery ? { noindex: true } : undefined);
}

export default async function SorPage({ searchParams }: Props) {
  const [params, enabled] = await Promise.all([searchParams.then(parseSorParams), zekaSurfaceEnabled("public")]);
  return (
    <div className="mk bg-surface text-text">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-brand-700">Zeka</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">EmlakSoft&apos;a sor</h1>
        <p className="mt-3 max-w-2xl text-text-muted">
          Paketler, fiyatlar, özellikler, KVKK ve kullanım hakkında sorun; yanıt EmlakSoft&apos;un kendi bilgisinden gelir. Kişisel veri yazmayın.
        </p>
        <div className="mt-8">{enabled ? <ZekaDock key={params.q ?? ""} surface="public" layout="page" page={params.from} initialQuestion={params.q} title="EmlakSoft'a sor" placeholder="Fiyat, özellik ya da kullanım sorun…" /> : <SorClosed />}</div>
      </main>
      <SiteFooter zeka={false} />
    </div>
  );
}

async function SorClosed() {
  const support = await getSupportContact();
  return (
    <div role="status" className="rounded-[var(--radius-panel)] border border-line bg-surface-2 p-6 sm:p-8">
      <h2 className="font-display text-xl font-bold text-ink-950">Soru asistanı şu an kapalı</h2>
      <p className="mt-2 max-w-2xl text-text-muted">Kısa bir süre için yanıt veremiyoruz. Sorunuzu bize doğrudan iletin; en kısa sürede dönelim.</p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <a
          href={support.mailto}
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Bize yazın: {support.email}
        </a>
        <Link
          href="/fiyatlar"
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line-strong px-5 text-sm font-semibold text-ink-950 hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          Fiyatları inceleyin
        </Link>
      </div>
    </div>
  );
}
