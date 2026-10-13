import { ToolsShell } from "@/components/tools/tools-shell";

// Robots: Next 404 yanıtına kendi `noindex` meta'sını ekler; burada ikinci bir robots etiketi yazılmaz.
export const metadata = { title: "Rehber yazısı bulunamadı" };

/** /rehber altında bulunamayan ya da yayından kaldırılmış yazı. İstemci bileşeni yok. */
export default function GuideNotFound() {
  return (
    <ToolsShell>
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-brand-700">Rehber</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-ink-950">Bu yazı bulunamadı</h1>
        <p className="mx-auto mt-3 max-w-xl text-text-muted">Yazı yayından kaldırılmış ya da adresi değişmiş olabilir. Güncel rehberlere göz atın.</p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- rehber sayfaları istemci bileşeni taşımaz (next/link yok) */}
          <a href="/rehber" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
            Tüm rehberler
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- rehber sayfaları istemci bileşeni taşımaz (next/link yok) */}
          <a href="/araclar" className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-5 text-sm font-semibold text-ink-950 hover:bg-surface-2">
            Ücretsiz araçlar
          </a>
        </div>
      </div>
    </ToolsShell>
  );
}
