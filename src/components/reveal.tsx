import type { ReactNode } from "react";

type RevealProps = {
  children: ReactNode;
  className?: string;
  variant?: "up" | "scale";
  delay?: number;
  as?: "div" | "section" | "li" | "span";
};

export function Reveal({
  children,
  className = "",
  as = "div",
}: RevealProps) {
  const Tag = as as "div";

  return (
    <Tag className={className}>
      {children}
    </Tag>
  );
}
