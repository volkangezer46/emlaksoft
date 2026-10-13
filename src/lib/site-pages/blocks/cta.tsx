import type { CtaBlock } from "../schema-core";
import { BlockLink } from "./shared";

/** Çağrı kutusu: /fiyatlar son çağrısıyla aynı koyu panel. */
export function CtaBlockView({ block }: { block: CtaBlock }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-8 text-center sm:p-12">
        <div className="theme-dark">
          <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">{block.title}</h2>
          {block.text ? <p className="mx-auto mt-2 max-w-xl text-white/80">{block.text}</p> : null}
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <BlockLink link={block.primary} tone="onDarkPrimary" arrow />
            {block.secondary ? <BlockLink link={block.secondary} tone="onDarkSecondary" /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
