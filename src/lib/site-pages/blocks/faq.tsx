import type { FaqBlock } from "../schema-core";
import { Container } from "./shared";

/** SSS: /fiyatlar ile aynı açılır liste. FAQPage JSON-LD sayfa düzeyinde aynı listeden üretilir (sitePageFaq). */
export function FaqBlockView({ block }: { block: FaqBlock }) {
  if (block.items.length === 0) return null;
  return (
    <section className="py-10 sm:py-14">
      <Container narrow>
        <h2 className="font-display text-2xl font-extrabold text-ink-950 sm:text-3xl">Sık sorulan sorular</h2>
        <div className="mt-6 divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface">
          {block.items.map((f, i) => (
            <details key={i} className="motion-details group px-5 py-1">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold text-ink-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden className="text-xl leading-none text-brand-700 transition-transform group-open:rotate-45 motion-reduce:transition-none">+</span>
              </summary>
              <p className="whitespace-pre-line pb-4 text-text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}
