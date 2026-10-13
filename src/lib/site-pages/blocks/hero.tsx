import type { HeroBlock } from "../schema-core";
import { BlockLink } from "./shared";

/** Giriş bloğu: /fiyatlar üst bandıyla aynı koyu degrade; sayfanın ilk girişi h1, sonrakiler h2. */
export function HeroBlockView({ block, first }: { block: HeroBlock; first: boolean }) {
  const Heading = first ? "h1" : "h2";
  return (
    <div className="bg-[image:var(--grad-ink)]">
      <div className="theme-dark mx-auto max-w-6xl px-4 py-14 text-center sm:px-6 sm:py-20">
        {block.eyebrow ? <p className="text-sm font-bold uppercase tracking-[0.08em] text-mint-400">{block.eyebrow}</p> : null}
        <Heading className="mx-auto mt-3 max-w-3xl font-display text-3xl font-extrabold text-white sm:text-5xl">{block.title}</Heading>
        {block.lead ? <p className="mx-auto mt-4 max-w-2xl text-base text-white/80 sm:text-lg">{block.lead}</p> : null}
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <BlockLink link={block.primary} tone="onDarkPrimary" arrow />
          {block.secondary ? <BlockLink link={block.secondary} tone="onDarkSecondary" /> : null}
        </div>
      </div>
    </div>
  );
}
