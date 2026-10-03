import type { ReactNode } from "react";

/** Eyebrow + h2 + (isteğe bağlı) açıklama. Serif vurgu için başlığa <Em> yerleştirilir. */
export function SectionHeading({
  eyebrow,
  title,
  text,
  center = false,
}: {
  eyebrow: string;
  title: ReactNode;
  text?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`mk-head mk-reveal${center ? " mk-center" : ""}`}>
      <p className="mk-eyebrow">{eyebrow}</p>
      <h2 className="mk-h2">{title}</h2>
      {text ? <p className="mk-lead">{text}</p> : null}
    </div>
  );
}

/** Başlıkta 1-3 kelimelik mavi→mor gradyan vurgu. */
export function Em({ children }: { children: ReactNode }) {
  return <span className="mk-grad">{children}</span>;
}
