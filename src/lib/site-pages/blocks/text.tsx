import { paragraphLines, type TextBlock } from "../schema-core";
import { Container } from "./shared";

/** Metin bloğu: düz yazı; her satır sonu ayrı paragraf olur, HTML/markdown işlenmez (React metni kaçışlı basar). */
export function TextBlockView({ block }: { block: TextBlock }) {
  const paragraphs = block.paragraphs.flatMap(paragraphLines);
  const bullets = block.bullets.map((b) => b.trim()).filter(Boolean);
  if (!block.heading && paragraphs.length === 0 && bullets.length === 0) return null;
  return (
    <section className="py-10 sm:py-14">
      <Container narrow>
        {block.heading ? <h2 className="font-display text-2xl font-extrabold text-ink-950 sm:text-3xl">{block.heading}</h2> : null}
        <div className={`${block.heading ? "mt-4" : ""} space-y-4 text-base leading-relaxed text-text`}>
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {bullets.length ? (
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-text">
            {bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        ) : null}
      </Container>
    </section>
  );
}
