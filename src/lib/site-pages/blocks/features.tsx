import { menuIconComponent } from "@/lib/site-menu/icon-registry";
import type { FeaturesBlock } from "../schema-core";
import { Container } from "./shared";

/** Özellik kartları: simge yalnız kontrollü listeden (icon-registry); bilinmeyen ad çizilmez. */
export function FeaturesBlockView({ block }: { block: FeaturesBlock }) {
  if (block.items.length === 0) return null;
  return (
    <section className="py-10 sm:py-14">
      <Container>
        {block.heading ? <h2 className="font-display text-2xl font-extrabold text-ink-950 sm:text-3xl">{block.heading}</h2> : null}
        <ul className={`${block.heading ? "mt-8" : ""} grid gap-4 sm:grid-cols-2 lg:grid-cols-3`}>
          {block.items.map((it, i) => {
            const Icon = menuIconComponent(it.icon);
            return (
              <li key={i} className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface-2 p-4">
                {Icon ? (
                  <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-700">
                    <Icon aria-hidden className="h-5 w-5" />
                  </span>
                ) : null}
                <div>
                  <h3 className="text-sm font-bold text-ink-950">{it.title}</h3>
                  {it.text ? <p className="mt-1 text-sm text-text-muted">{it.text}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}
