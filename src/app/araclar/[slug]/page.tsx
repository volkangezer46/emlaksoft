import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ToolsCta, ToolsShell } from "@/components/tools/tools-shell";
import {
  CommissionCalculator,
  LoanCalculator,
  PurchaseCostCalculator,
  RentalYieldCalculator,
} from "@/components/tools/calculators";
import { getBaseUrl } from "@/lib/base-url";
import { getPublishedTool, publishedTools, type ToolSlug } from "@/lib/tools/registry";

export const dynamicParams = false;

export function generateStaticParams() {
  return publishedTools().map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const tool = getPublishedTool((await params).slug);
  if (!tool) return {};
  const path = `/araclar/${tool.slug}`;
  return {
    title: tool.title,
    description: tool.description,
    alternates: { canonical: path },
    openGraph: { title: `${tool.title} | EmlakSoft`, description: tool.description, url: path, type: "website" },
  };
}

function Calculator({ slug }: { slug: ToolSlug }) {
  switch (slug) {
    case "komisyon-hesaplama":
      return <CommissionCalculator />;
    case "tapu-masrafi-hesaplama":
      return <PurchaseCostCalculator />;
    case "kira-getirisi-hesaplama":
      return <RentalYieldCalculator />;
    case "konut-kredisi-taksit-hesaplama":
      return <LoanCalculator />;
  }
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const tool = getPublishedTool((await params).slug);
  if (!tool) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: tool.title,
    description: tool.description,
    url: `${getBaseUrl()}/araclar/${tool.slug}`,
    inLanguage: "tr",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "TRY" },
  };

  return (
    <ToolsShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <nav aria-label="Konum" className="text-sm text-text-muted">
          <Link href="/araclar" className="inline-flex min-h-11 items-center hover:underline">Araçlar</Link>
        </nav>
        <h1 className="mt-1 font-display text-3xl font-extrabold text-ink-950 sm:text-4xl">{tool.h1}</h1>
        <p className="mt-3 max-w-2xl text-text-muted">{tool.description}</p>
        <div className="mt-8">
          <Calculator slug={tool.slug} />
        </div>

        <section aria-labelledby="nasil" className="mt-12 max-w-3xl">
          <h2 id="nasil" className="font-display text-2xl font-extrabold text-ink-950">Nasıl hesaplanır?</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-text-muted">
            {tool.how.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="sss" className="mt-10 max-w-3xl">
          <h2 id="sss" className="font-display text-2xl font-extrabold text-ink-950">Sık sorulan sorular</h2>
          <dl className="mt-4 space-y-4">
            {tool.faq.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold text-ink-950">{f.q}</dt>
                <dd className="mt-1 text-text-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <ToolsCta slug={tool.slug} />
    </ToolsShell>
  );
}
