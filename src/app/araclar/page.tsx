import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ToolsShell } from "@/components/tools/tools-shell";
import { publishedTools } from "@/lib/tools/registry";

export const metadata: Metadata = {
  title: "Ücretsiz emlak hesaplama araçları",
  description:
    "Komisyon, tapu ve alım masrafı, kira getirisi ve konut kredisi taksit hesaplayıcıları. Ücretsiz, kayıt gerekmez; veriler tarayıcınızda hesaplanır.",
  alternates: { canonical: "/araclar" },
  openGraph: {
    title: "Ücretsiz emlak hesaplama araçları | EmlakSoft",
    description: "Komisyon, alım masrafı, kira getirisi ve kredi taksiti için ücretsiz hesaplayıcılar.",
    url: "/araclar",
    type: "website",
  },
};

export default function ToolsIndexPage() {
  const tools = publishedTools();
  return (
    <ToolsShell>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-bold uppercase tracking-[0.08em] text-brand-700">Araçlar</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">Ücretsiz emlak hesaplama araçları</h1>
        <p className="mt-3 max-w-2xl text-text-muted">
          Kayıt gerekmez. Girdiğiniz sayılar tarayıcınızda hesaplanır, sunucuya gönderilmez. Sonuçlar tahmindir; hukuki veya mali tavsiye değildir.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/araclar/${t.slug}`}
                className="flex h-full flex-col rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-sm)] hover:border-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <h2 className="font-display text-lg font-bold text-ink-950">{t.title}</h2>
                <p className="mt-2 flex-1 text-sm text-text-muted">{t.description}</p>
                <span className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">
                  Hesapla <ArrowRight aria-hidden className="ml-1 h-4 w-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </ToolsShell>
  );
}
